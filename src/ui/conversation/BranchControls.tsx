import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import type { SessionTreeResult } from "../../../shared/ipc";
import clsx from "clsx";
import { Pencil, RefreshCw } from "lucide-react";
import type { UserMessageItem } from "../../../shared/protocol";
import { useT } from "../../i18n";
import { useActions, useAppSelector } from "../app-context";
import { Button, focusRing } from "../kit";
import { TESTID } from "../testids";
import { resendOf } from "./resend";

/** Where a branch starts: the thread and the turn that holds the user message. */
export interface BranchAt {
  threadId: string;
  turnId: string;
}

function useBranch({ threadId, turnId }: BranchAt): (item: UserMessageItem, text: string) => Promise<boolean> {
  const actions = useActions();
  return useCallback(
    (item, text) => actions.branchFrom(threadId, turnId, item.id, text, ""),
    [actions, threadId, turnId],
  );
}

/** Alternative answers stay in one native session rather than creating sidebar entries. */
export function SessionBranches({ threadId }: { threadId: string }) {
  const bridge = window.omo;
  const actions = useActions();
  const t = useT();
  const lastTurn = useAppSelector(state => state.conversations[threadId]?.turns.at(-1));
  const loaded = useAppSelector(state => state.conversations[threadId]?.historyState === "loaded");
  const running = useAppSelector(state => state.conversations[threadId]?.activeTurnId !== null);
  const [tree, setTree] = useState<SessionTreeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    void bridge.sessionTree(threadId, { type: "list" }).then(value => { if (!cancelled) setTree(value); }, () => { if (!cancelled) setTree(null); });
    return () => { cancelled = true; };
  }, [bridge, threadId, loaded, lastTurn?.id, lastTurn?.status, revision]);
  if (!tree || tree.branches.length < 2) return null;
  return (
    <label className="flex min-w-0 items-center gap-2 px-4 py-2 text-xs leading-5 text-muted-foreground">
      <span>{t("conversation.branch.versions")}</span>
      <select className={clsx("m-0 min-w-0 max-w-[min(480px,70%)] truncate rounded-md border border-solid border-input bg-background px-2 py-1 text-xs leading-5 text-foreground [font-family:inherit]", focusRing)} data-testid="session-branches" aria-label={t("conversation.branch.versions")} disabled={running || busy}
        value={tree.branches.find(branch => branch.active)?.entryId ?? ""}
        onChange={event => {
          setBusy(true);
          void actions.switchBranch(threadId, event.target.value, tree.leafId).finally(() => { setBusy(false); setRevision(value => value + 1); });
        }}>
        {tree.branches.map((branch, index) => <option key={branch.entryId} value={branch.entryId}>{index + 1}. {branch.label}</option>)}
      </select>
    </label>
  );
}

/** The edit button under a user bubble; it opens `onEdit`. Hidden until the row is hovered or focused. */
export const userRowClass = "group/user flex min-w-0 flex-col";

export function EditMessageButton({ onEdit, disabled }: { onEdit: () => void; disabled: boolean }) {
  const t = useT();
  return (
    <div className="mt-0.5 flex justify-end opacity-0 transition-opacity duration-150 group-hover/user:opacity-100 group-focus-within/user:opacity-100 motion-reduce:transition-none">
      <button
        type="button"
        className={clsx(
          "m-0 inline-flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground",
          "transition-colors duration-150 hover:not-disabled:bg-accent hover:not-disabled:text-accent-foreground disabled:cursor-default disabled:opacity-50 motion-reduce:transition-none",
          focusRing,
        )}
        data-testid={TESTID.editMessage}
        aria-label={t("conversation.user.edit")}
        title={disabled ? t("notice.branchBusy") : t("conversation.user.edit")}
        disabled={disabled}
        onClick={onEdit}
      >
        <Pencil className="size-3.5" aria-hidden />
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
    <div className="ml-auto box-border flex w-full max-w-[min(32rem,100%)] flex-col gap-2 self-stretch rounded-2xl border border-solid border-border bg-message-user px-3 py-2.5" data-testid={TESTID.editMessageForm}>
      <textarea
        className="m-0 box-border w-full resize-y border-0 bg-transparent p-0 text-sm leading-6 text-message-user-foreground outline-none [font-family:inherit]"
        data-testid={TESTID.editMessageInput}
        aria-label={t("conversation.user.edit")}
        value={text}
        autoFocus
        rows={Math.min(10, Math.max(2, text.split("\n").length))}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs leading-5 text-muted-foreground">{t("conversation.branch.hint")}</span>
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

/** Regenerates inside the same session, keeping the current answer on its original tree branch. */
export function RegenerateButton({ at, item, disabled }: { at: BranchAt; item: UserMessageItem; disabled: boolean }) {
  const t = useT();
  const branch = useBranch(at);
  const [busy, setBusy] = useState(false);
  return (
    <Button
        variant="ghost"
        size="sm"
        icon={<RefreshCw aria-hidden />}
        data-testid={TESTID.regenerate}
        title={disabled ? t("notice.branchBusy") : t("conversation.branch.regenerateHint")}
        disabled={disabled || busy}
        onClick={() => {
          setBusy(true);
          void branch(item, resendOf(item.content).text).finally(() => setBusy(false));
        }}
      >
        {t("conversation.branch.regenerate")}
      </Button>
  );
}
