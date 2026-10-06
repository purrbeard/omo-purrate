import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button, CodeBlock, Input, StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ApprovalDecision, ThreadItem } from "../../../shared/protocol";
import { useT } from "../../i18n";
import type { PendingRequest } from "../../state";
import { useActions } from "../app-context";
import { TESTID } from "../testids";
import { displayPath, isRecord } from "./format";
import { useConversationLabels } from "./labels";
import css from "./ApprovalCard.module.css";

export type ApprovalRequest = Extract<PendingRequest, { kind: "commandApproval" | "fileChangeApproval" }>;

const ALL_DECISIONS: readonly ApprovalDecision[] = ["accept", "acceptForSession", "decline", "cancel"];

function isEditableTarget(target: EventTarget): boolean {
  return target instanceof Element && target.closest("input, textarea, select, button, a[href], [contenteditable]") !== null;
}

function relatedCode(item: ThreadItem | null): { text: string; language: string | undefined } | null {
  if (item?.type !== "dynamicToolCall" || !isRecord(item.arguments)) return null;
  const code = item.arguments["code"];
  const language = item.arguments["language"];
  return typeof code === "string" && code !== ""
    ? { text: code, language: typeof language === "string" ? language : undefined }
    : null;
}

/** DSH ApprovalPanel port, rendered inline after the last turn. Enter allows once and Escape denies while focus is on the card itself. */
export function ApprovalCard({
  request,
  related,
  cwd,
}: {
  request: ApprovalRequest;
  related: ThreadItem | null;
  cwd: string | null;
}) {
  const t = useT();
  const actions = useActions();
  const labels = useConversationLabels();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const params = request.params;
  const command = request.kind === "commandApproval" ? (request.params.command ?? null) : null;
  const code = useMemo(() => (command === null ? relatedCode(related) : null), [command, related]);
  const workingDirectory = request.kind === "commandApproval" ? (request.params.cwd ?? null) : null;
  const grantRoot = request.kind === "fileChangeApproval" ? (request.params.grantRoot ?? null) : null;
  const changedPaths = useMemo(
    () => (related?.type === "fileChange" ? related.changes.map((change) => displayPath(change.path, cwd)) : []),
    [related, cwd],
  );
  const decisions =
    request.kind === "commandApproval" ? (request.params.availableDecisions ?? ALL_DECISIONS) : ALL_DECISIONS;
  const offers = (decision: ApprovalDecision): boolean => decisions.includes(decision);
  const explanation = params.reason?.trim() ?? "";

  const answer = (decision: ApprovalDecision): void => {
    if (busy || !offers(decision)) return;
    setBusy(true);
    const note = reason.trim();
    void actions.answerApproval(request.id, decision, decision === "decline" && note !== "" ? note : undefined).finally(() => {
      if (mounted.current) setBusy(false);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || isEditableTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    answer(event.key === "Enter" ? "accept" : "decline");
  };

  return (
    <div
      className={css.card}
      data-testid={TESTID.approvalCard}
      data-kind={request.kind}
      data-request-id={String(request.id)}
      aria-busy={busy}
      onKeyDown={onKeyDown}
    >
      <div className={css.strip}>
        <StateDot state={busy ? "ongoing" : "warning"} />
        {t("conversation.approval.waiting")}
      </div>
      <div className={css.body} role="group" tabIndex={0} aria-label={t("conversation.approval.details")}>
        <div className={css.headline}>
          {t(request.kind === "commandApproval" ? "conversation.approval.command" : "conversation.approval.fileChange")}
        </div>
        {command !== null && command !== "" && (
          <CodeBlock
            code={command}
            lang="bash"
            copyLabel={labels.copy}
            copiedLabel={labels.copied}
            toolbarLabels={labels.toolbar}
            className={css.code}
          />
        )}
        {code !== null && (
          <CodeBlock
            code={code.text}
            lang={code.language}
            copyLabel={labels.copy}
            copiedLabel={labels.copied}
            toolbarLabels={labels.toolbar}
            className={css.code}
          />
        )}
        {changedPaths.length > 0 && (
          <ul className={css.paths}>
            {changedPaths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        )}
        {(workingDirectory !== null || grantRoot !== null || explanation !== "") && (
          <dl className={css.meta}>
            {workingDirectory !== null && (
              <>
                <dt>{t("conversation.approval.cwd")}</dt>
                <dd className={css.mono}>{workingDirectory}</dd>
              </>
            )}
            {grantRoot !== null && (
              <>
                <dt>{t("conversation.approval.grantRoot")}</dt>
                <dd className={css.mono}>{grantRoot}</dd>
              </>
            )}
            {explanation !== "" && (
              <>
                <dt>{t("conversation.approval.reason")}</dt>
                <dd>{explanation}</dd>
              </>
            )}
          </dl>
        )}
      </div>
      {offers("decline") && (
        <Input
          className={css.reason}
          value={reason}
          disabled={busy}
          placeholder={t("conversation.approval.declineReason")}
          aria-label={t("conversation.approval.declineReason")}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              answer("decline");
            }
          }}
        />
      )}
      <div className={css.actions}>
        {offers("decline") && (
          <Button
            variant="outline"
            className={css.decline}
            disabled={busy}
            data-testid={TESTID.approvalDecline}
            onClick={() => answer("decline")}
          >
            {t("conversation.approval.decline")}
          </Button>
        )}
        {offers("acceptForSession") && (
          <Button
            variant="outline"
            disabled={busy}
            data-testid={TESTID.approvalAcceptSession}
            onClick={() => answer("acceptForSession")}
          >
            {t("conversation.approval.acceptSession")}
          </Button>
        )}
        {offers("accept") && (
          <Button variant="primary" disabled={busy} data-testid={TESTID.approvalAccept} onClick={() => answer("accept")}>
            {t("conversation.approval.accept")}
          </Button>
        )}
      </div>
    </div>
  );
}
