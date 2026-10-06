import { useCallback, useState, type KeyboardEvent } from "react";
import { Button, IconEditOutlineRegular, IconRefreshOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import type { UserMessageItem } from "../../../shared/protocol";
import { useT } from "../../i18n";
import { useActions, useAppSelector } from "../app-context";
import { TESTID } from "../testids";
import { threadTitle } from "./format";
import { resendOf } from "./resend";
import css from "./BranchControls.module.css";

/** Where a branch starts: the thread and the turn that holds the user message. */
export interface BranchAt {
  threadId: string;
  turnId: string;
}

function useBranch({ threadId, turnId }: BranchAt): (item: UserMessageItem, text: string) => Promise<boolean> {
  const t = useT();
  const actions = useActions();
  const title = useAppSelector((state) => threadTitle(state.threads[threadId] ?? null, t("shell.newSession")));
  // A branch of a branch keeps its title instead of stacking the suffix.
  const suffix = t("conversation.branch.name", { title: "" });
  const name = title.endsWith(suffix) ? title : t("conversation.branch.name", { title });
  return useCallback(
    (item, text) => actions.branchFrom(threadId, turnId, item.id, text, name),
    [actions, threadId, turnId, name],
  );
}

/** The edit button under a user bubble; it opens `onEdit`. Hidden until the row is hovered or focused. */
export const userRowClass = css.userRow;

export function EditMessageButton({ onEdit, disabled }: { onEdit: () => void; disabled: boolean }) {
  const t = useT();
  return (
    <div className={css.userActions}>
      <button
        type="button"
        className={css.iconButton}
        data-testid={TESTID.editMessage}
        aria-label={t("conversation.user.edit")}
        title={disabled ? t("notice.branchBusy") : t("conversation.user.edit")}
        disabled={disabled}
        onClick={onEdit}
      >
        <IconEditOutlineRegular size={14} />
      </button>
    </div>
  );
}

/** Inline editor that replaces a user bubble; sending opens the edited message as a new branch of the thread. */
export function EditMessageForm({ at, item, onClose }: { at: BranchAt; item: UserMessageItem; onClose: () => void }) {
  const t = useT();
  const branch = useBranch(at);
  const [text, setText] = useState(() => resendOf(item.content).text);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    if (text.trim() === "" || busy) return;
    setBusy(true);
    const sent = await branch(item, text.trim());
    setBusy(false);
    if (sent) onClose();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Escape") onClose();
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  };
  return (
    <div className={css.editor} data-testid={TESTID.editMessageForm}>
      <textarea
        className={css.editorInput}
        data-testid={TESTID.editMessageInput}
        aria-label={t("conversation.user.edit")}
        value={text}
        autoFocus
        rows={Math.min(10, Math.max(2, text.split("\n").length))}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className={css.editorFooter}>
        <span className={css.editorHint}>{t("conversation.branch.hint")}</span>
        <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
          {t("conversation.branch.cancel")}
        </Button>
        <Button variant="primary" size="sm" data-testid={TESTID.editMessageSend} disabled={busy || text.trim() === ""} onClick={() => void submit()}>
          {t(busy ? "conversation.branch.sending" : "conversation.branch.send")}
        </Button>
      </div>
    </div>
  );
}

/** Regenerates the answer to `item` in a new branch, keeping the current answer in the original thread. */
export function RegenerateButton({ at, item, disabled }: { at: BranchAt; item: UserMessageItem; disabled: boolean }) {
  const t = useT();
  const branch = useBranch(at);
  const [busy, setBusy] = useState(false);
  return (
    <div className={css.turnActions}>
      <button
        type="button"
        className={css.textButton}
        data-testid={TESTID.regenerate}
        title={disabled ? t("notice.branchBusy") : t("conversation.branch.regenerateHint")}
        disabled={disabled || busy}
        onClick={() => {
          setBusy(true);
          void branch(item, resendOf(item.content).text).finally(() => setBusy(false));
        }}
      >
        <IconRefreshOutlineRegular size={14} />
        <span>{t("conversation.branch.regenerate")}</span>
      </button>
    </div>
  );
}
