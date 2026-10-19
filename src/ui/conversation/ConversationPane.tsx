import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionNotice } from "../../../shared/ipc";
import clsx from "clsx";
import { MarkdownDelegateProvider, StateDot, TextShimmer } from "@deepseek-ai/dsh-client-ui-primitives";
import { ArrowDown, CircleAlert } from "lucide-react";
import { resolveWorkspacePath } from "@deepseek-ai/dsh-util-workspace-path";
import type { ThreadItem } from "../../../shared/protocol";
import { useT } from "../../i18n";
import type { Conversation, ConversationTurn, PendingRequest } from "../../state";
import { selectActiveConversation, selectIsTurnActive, selectPendingRequestsForThread, selectMainThreadId, selectTasks } from "../../state";
import { useActions, useAppSelector } from "../app-context";
import { Button, focusRing } from "../kit";
import { TESTID } from "../testids";
import { uiState, useUiState } from "../ui-state";
import { ActivityToggle } from "./ActivityPanel";
import { ApprovalCard } from "./ApprovalCard";
import { ConversationHeader } from "./ConversationHeader";
import { SessionBranches } from "./BranchControls";
import { EmptyHero } from "./EmptyHero";
import { QuestionCard } from "./QuestionCard";
import { RenderBoundary } from "./RenderBoundary";
import { TurnView, type BranchContext } from "./TurnView";
import { userMessageParts, UserBubble } from "./UserBubble";
import { useStickToBottom } from "./use-stick-to-bottom";
import { durationParts, QUIET_AFTER_MS, workingStatus } from "./working-status";

const NO_TURNS: readonly ConversationTurn[] = [];

function requestKey(request: PendingRequest): string {
  return `${request.kind}:${String(request.id)}`;
}

function relatedItem(conversation: Conversation | null, turnId: string, itemId: string): ThreadItem | null {
  const turn = conversation?.turns.find((candidate) => candidate.id === turnId);
  return turn?.items.find((entry) => entry.item.id === itemId)?.item ?? null;
}

function HistorySkeleton() {
  const t = useT();
  return (
    <div className="flex flex-col gap-3 [&>span]:block [&>span]:animate-pulse [&>span]:bg-muted motion-reduce:[&>span]:animate-none" role="status" aria-label={t("conversation.history.loading")}>
      <span className="mb-2 h-10 w-5/12 self-end rounded-2xl" />
      <span className="h-3.5 w-11/12 rounded-sm" />
      <span className="h-3.5 w-9/12 rounded-sm" />
      <span className="h-3.5 w-7/12 rounded-sm" />
    </div>
  );
}

function HistoryError({ threadId, message }: { threadId: string; message: string | null }) {
  const t = useT();
  const actions = useActions();
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-solid border-destructive-foreground/30 bg-destructive px-3 py-2.5 text-sm leading-5" data-testid={TESTID.historyError} role="alert">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive-foreground" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col [overflow-wrap:anywhere]" title={message ?? undefined}>
        <span className="font-semibold text-destructive-foreground">{t("conversation.history.error")}</span>
        <span className="text-muted-foreground">{t("conversation.history.errorHint")}</span>
      </div>
      <Button variant="outline" size="sm" onClick={() => void actions.openThread(threadId)}>
        {t("conversation.history.retry")}
      </Button>
    </div>
  );
}

function WorkingIndicator({ turn }: { turn: ConversationTurn | null }) {
  const t = useT();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const status = turn === null ? null : workingStatus(turn, nowMs);
  const format = (ms: number): string => {
    const { minutes, seconds } = durationParts(ms);
    return minutes > 0 ? t("conversation.duration.minutes", { minutes, seconds }) : t("conversation.duration.seconds", { seconds });
  };
  return (
    <div className="-mt-3 inline-flex items-center gap-1.5 self-start text-xs leading-6 text-muted-foreground" data-testid={TESTID.workingIndicator} data-queued={status?.queuedMessage || undefined} role="status">
      <StateDot state="ongoing" size={12} />
      <TextShimmer active>{t("conversation.working")}</TextShimmer>
      {status !== null && (
        <span className="tabular-nums opacity-80" data-testid={TESTID.workingDetail}>
          {format(status.elapsedMs)}
          {status.idleMs >= QUIET_AFTER_MS && ` · ${t("conversation.working.lastActivity", { time: format(status.idleMs) })}`}
          {status.queuedMessage && ` · ${t("conversation.working.queued")}`}
        </span>
      )}
    </div>
  );
}

function PendingRequestCard({
  request,
  conversation,
  cwd,
}: {
  request: PendingRequest;
  conversation: Conversation | null;
  cwd: string | null;
}) {
  if (request.kind === "userInput") return <QuestionCard request={request} />;
  return (
    <ApprovalCard
      request={request}
      related={relatedItem(conversation, request.params.turnId, request.params.itemId)}
      cwd={cwd}
    />
  );
}

function Transcript({ threadId, cwd, turnActive }: { threadId: string; cwd: string | null; turnActive: boolean }) {
  const t = useT();
  const hasPath = useAppSelector((state) => (state.threads[threadId]?.path ?? null) !== null);
  const conversation = useAppSelector(selectActiveConversation);
  const tasks = useAppSelector((state) => selectTasks(state, threadId));
  const pending = useAppSelector((state) => selectPendingRequestsForThread(state, threadId));
  const scroll = useStickToBottom();
  const turns = conversation?.turns ?? NO_TURNS;
  const annotations = conversation?.annotations;
  const noticesByTurn = useMemo(() => {
    const byTurn = new Map<number, SessionNotice[]>();
    for (const notice of annotations?.notices ?? []) byTurn.set(notice.turnIndex, [...(byTurn.get(notice.turnIndex) ?? []), notice]);
    return byTurn;
  }, [annotations?.notices]);
  const activeTurnId = conversation?.activeTurnId ?? null;
  const activeTurn = useMemo(
    () => (activeTurnId === null ? null : (turns.find((turn) => turn.id === activeTurnId) ?? null)),
    [turns, activeTurnId],
  );
  const streaming = activeTurn?.items.some((entry) => entry.streaming) ?? false;
  const showWorking = turnActive && !streaming && pending.length === 0;
  const historyState = conversation?.historyState ?? "idle";
  const branchIdle = !turnActive && (conversation?.pendingUserMessages.length ?? 0) === 0;
  const branch = useMemo<BranchContext | null>(() => (hasPath ? { threadId, idle: branchIdle } : null), [hasPath, threadId, branchIdle]);
  const empty =
    (historyState === "idle" || historyState === "loaded") &&
    turns.length === 0 &&
    pending.length === 0 &&
    !turnActive &&
    (conversation?.pendingUserMessages.length ?? 0) === 0;
  const openExternalLink = useCallback((href: string) => void window.omo.openExternal(href), []);
  const openFile = useCallback(
    (path: string) => void window.omo.revealPath(resolveWorkspacePath(cwd ?? undefined, path)),
    [cwd],
  );
  const { jumpToLatest } = scroll;
  const seenRequests = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const keys = new Set(pending.map(requestKey));
    const arrived = [...keys].some((key) => !seenRequests.current.has(key));
    seenRequests.current = keys;
    if (arrived) jumpToLatest();
  }, [pending, jumpToLatest]);

  return (
    <div className="relative flex min-h-24 flex-1 flex-col">
      {empty && <EmptyHero />}
      <div
        ref={scroll.scrollRef}
        className={clsx(
          "min-h-0 overflow-y-auto px-8 [container-type:inline-size] [scrollbar-gutter:stable_both-edges]",
          empty ? "h-0 flex-none overflow-hidden" : "flex-1 pt-6 pb-8",
        )}
        role="region"
        aria-label={t("conversation.region")}
      >
        <div ref={scroll.contentRef} className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {historyState === "loading" && <HistorySkeleton />}
          {historyState === "error" && <HistoryError threadId={threadId} message={conversation?.historyError ?? null} />}
          <MarkdownDelegateProvider openExternalLink={openExternalLink} openFile={openFile}>
            {turns.map((turn, index) => (
              <TurnView key={turn.id} turn={turn} cwd={cwd} branch={branch} last={index === turns.length - 1}
                notices={noticesByTurn.get(index)} memoryWrites={annotations?.memoryWrites} tasks={tasks} turns={turns}
                tasksLive={conversation?.live.freshness === "live"} />
            ))}
          </MarkdownDelegateProvider>
          {conversation?.pendingUserMessages.map((message) => (
            <UserBubble key={message.clientId} text={message.text} images={userMessageParts(message.images ?? []).images} sending />
          ))}
          {showWorking && <WorkingIndicator turn={activeTurn} />}
          {pending.map((request) => (
            <RenderBoundary key={requestKey(request)} label={`a ${request.kind} request`} resetKey={request}>
              <PendingRequestCard request={request} conversation={conversation} cwd={cwd} />
            </RenderBoundary>
          ))}
        </div>
      </div>
      {scroll.showJump && (
        <button
          type="button"
          className={clsx(
            "absolute bottom-4 left-1/2 z-10 m-0 inline-flex h-8 -translate-x-1/2 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full",
            "border border-solid border-border bg-popover pr-3.5 pl-2.5 text-sm leading-5 text-popover-foreground shadow-md [font-family:inherit]",
            "transition-colors duration-150 hover:bg-accent motion-reduce:transition-none",
            focusRing,
          )}
          onClick={scroll.jumpToLatest}
        >
          <ArrowDown className="size-3.5" aria-hidden />
          <span>{t("conversation.jumpToLatest")}</span>
        </button>
      )}
    </div>
  );
}

/** The main conversation column: header strip, then the empty hero or the active thread's transcript. */
export function ConversationPane() {
  const t = useT();
  const actions = useActions();
  const mainId = useAppSelector(selectMainThreadId);
  const showActivity = useUiState().workflowPanelOpen;
  const threadId = useAppSelector((state) => state.activeThreadId);
  const thread = useAppSelector((state) =>
    state.activeThreadId === null ? null : (state.threads[state.activeThreadId] ?? null),
  );
  const turnActive = useAppSelector(selectIsTurnActive);
  const toggleActivity = useCallback(() => {
    if (threadId === null) return;
    uiState.setWorkflowPanelOpen(!showActivity);
  }, [threadId, showActivity]);
  const activity = useMemo(
    () =>
      threadId === null ? null : (
        <ActivityToggle threadId={threadId} open={showActivity} controlsId="workflow-panel" onToggle={toggleActivity} />
      ),
    [threadId, showActivity, toggleActivity],
  );
  return (
    <section className="relative flex min-h-0 flex-1 flex-col" data-testid={TESTID.conversation}>
      <ConversationHeader active={threadId !== null} thread={thread} running={turnActive} activity={activity} panels={threadId === null ? null : <>
        {mainId !== null && threadId !== mainId && <Button variant="outline" size="sm" data-testid="agent-header-return-main" onClick={() => void actions.openThread(mainId)}>{t("activity.returnMain")}</Button>}
      </>} />
      {threadId !== null && <SessionBranches key={threadId} threadId={threadId} />}
      {threadId === null ? (
        <EmptyHero />
      ) : (
        <Transcript key={threadId} threadId={threadId} cwd={thread?.cwd ?? null} turnActive={turnActive} />
      )}
    </section>
  );
}
