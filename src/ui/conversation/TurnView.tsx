import { Fragment, memo, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, CircleAlert, CircleX, FileText, Layers, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import type { HistoricalTask, MemoryWriteNotice, SessionNotice } from "../../../shared/ipc";
import { MarkdownText, StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import type { LiveTask, TurnError, UserMessageItem } from "../../../shared/protocol";
import { useT } from "../../i18n";
import type { ConversationItem, ConversationTurn } from "../../state";
import { Badge, focusRing } from "../kit";
import { TESTID } from "../testids";
import { AssistantMessage } from "./AssistantMessage";
import { AnswerFooter } from "./AnswerFooter";
import { SubagentRow } from "./SubagentRow";
import { MemoryWriteCard, NoticeRow } from "./SessionNotices";
import { EditMessageButton, EditMessageForm, RegenerateButton, userRowClass, type BranchAt } from "./BranchControls";
import { EditedFilesCard } from "./EditedFilesCard";
import { editedFiles } from "./edited-files";
import { elapsedMs, formatWholeSeconds } from "./format";
import { useConversationLabels } from "./labels";
import { ReasoningRow } from "./ReasoningRow";
import { RenderBoundary } from "./RenderBoundary";
import { ToolCard } from "./ToolCard";
import { toolRowModel, type ToolRowModel } from "./tool-model";
import { UserBubble, userMessageParts } from "./UserBubble";
import { answerCompletedAt, completedAnswer, turnSubagents, workLogEntries } from "./work-log";

const NO_NOTICES: readonly SessionNotice[] = [];
const NO_WRITES: Readonly<Record<string, MemoryWriteNotice>> = {};
const NO_TASKS: readonly (LiveTask | HistoricalTask)[] = [];
const NO_TURNS: readonly ConversationTurn[] = [];

function assertNever(value: never): never {
  throw new Error(`Unhandled conversation item: ${JSON.stringify(value)}`);
}

/** Who may branch from a turn's messages: the thread, and whether no turn of it is running. */
export interface BranchContext {
  threadId: string;
  idle: boolean;
}

/** A BranchContext narrowed to one turn; item ids are only unique within their turn. */
type TurnBranch = BranchContext & BranchAt;

function UserMessageView({ item, branch }: { item: UserMessageItem; branch: TurnBranch | null }) {
  const { text, images } = useMemo(() => userMessageParts(item.content), [item.content]);
  const [editing, setEditing] = useState(false);
  if (text === "" && images.length === 0) return null;
  if (branch === null) return <UserBubble text={text} images={images} />;
  if (editing) return <EditMessageForm at={branch} item={item} onClose={() => setEditing(false)} />;
  return (
    <div className={userRowClass}>
      <UserBubble text={text} images={images} />
      <EditMessageButton disabled={!branch.idle} onEdit={() => setEditing(true)} />
    </div>
  );
}

function PlanBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const t = useT();
  const labels = useConversationLabels();
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-solid border-border px-3.5 pt-2.5 pb-3" data-flow="plan">
      <div className="flex items-center gap-1.5 text-xs leading-5 text-muted-foreground">
        <FileText className="size-3.5" aria-hidden />
        <span>{t("conversation.plan")}</span>
      </div>
      <MarkdownText text={text} streaming={streaming} labels={labels.markdown} variant="compact" />
    </div>
  );
}

function CompactionDivider() {
  const t = useT();
  return (
    <div className="my-1.5 flex items-center gap-1.5 whitespace-nowrap text-xs leading-5 text-muted-foreground before:h-px before:flex-1 before:bg-border before:content-[''] after:h-px after:flex-1 after:bg-border after:content-['']" data-flow="compaction">
      <Layers className="size-3.5" aria-hidden />
      <span>{t("conversation.compacted")}</span>
    </div>
  );
}

function renderItem(entry: ConversationItem, cwd: string | null, branch: TurnBranch | null): ReactNode {
  const { item } = entry;
  switch (item.type) {
    case "userMessage":
      return <UserMessageView item={item} branch={branch} />;
    case "agentMessage":
      return <AssistantMessage id={item.id} text={item.text} streaming={entry.streaming} />;
    case "reasoning":
      return (
        <ReasoningRow
          item={item}
          streaming={entry.streaming}
          durationMs={elapsedMs(entry.startedAtMs, entry.completedAtMs)}
        />
      );
    case "plan":
      return <PlanBlock text={item.text} streaming={entry.streaming} />;
    case "contextCompaction":
      return <CompactionDivider />;
    case "commandExecution":
    case "fileChange":
    case "mcpToolCall":
    case "dynamicToolCall":
    case "webSearch":
      return <ToolCard entry={entry} item={item} cwd={cwd} />;
    default:
      return assertNever(item);
  }
}

const ItemView = memo(function ItemView({ entry, cwd, branch }: { entry: ConversationItem; cwd: string | null; branch: TurnBranch | null }) {
  return (
    <RenderBoundary label={`a ${entry.item.type} item`} resetKey={entry}>
      {renderItem(entry, cwd, branch)}
    </RenderBoundary>
  );
});

function toolModel(entry: ConversationItem, cwd: string | null): ToolRowModel | null {
  switch (entry.item.type) {
    case "commandExecution":
    case "fileChange":
    case "mcpToolCall":
    case "dynamicToolCall":
    case "webSearch":
      return toolRowModel(entry.item, entry.streaming, elapsedMs(entry.startedAtMs, entry.completedAtMs), cwd);
    default:
      return null;
  }
}

/** A run of consecutive same-kind tool calls (two or more) is shown under one heading. */
type WorkSegment =
  | { kind: "item"; entry: ConversationItem }
  | { kind: "group"; key: string; label: string; entries: ConversationItem[] };

function workSegments(
  entries: readonly ConversationItem[],
  models: ReadonlyMap<string, ToolRowModel>,
  memoryWrites: Readonly<Record<string, MemoryWriteNotice>>,
  title: (model: ToolRowModel) => string,
): WorkSegment[] {
  const segments: WorkSegment[] = [];
  let run: ConversationItem[] = [];
  const flush = (): void => {
    const first = run[0];
    const model = first === undefined ? undefined : models.get(first.item.id);
    if (first !== undefined && model !== undefined && run.length > 1) {
      segments.push({ kind: "group", key: first.item.id, label: title(model), entries: run });
    } else run.forEach((entry) => segments.push({ kind: "item", entry }));
    run = [];
  };
  for (const entry of entries) {
    const model = models.get(entry.item.id);
    const groupable = model !== undefined && memoryWrites[entry.item.id] === undefined;
    const previous = run[0] === undefined ? undefined : models.get(run[0].item.id);
    if (!groupable || previous === undefined || previous.kind !== model.kind || previous.title !== model.title) flush();
    if (groupable) run.push(entry);
    else segments.push({ kind: "item", entry });
  }
  flush();
  return segments;
}

function WorkLog({ entries, turn, cwd, memoryWrites }: {
  entries: readonly ConversationItem[];
  turn: ConversationTurn;
  cwd: string | null;
  memoryWrites: Readonly<Record<string, MemoryWriteNotice>>;
}) {
  const t = useT();
  const models = useMemo(() => {
    const byId = new Map<string, ToolRowModel>();
    for (const entry of entries) {
      const model = toolModel(entry, cwd);
      if (model !== null) byId.set(entry.item.id, model);
    }
    return byId;
  }, [entries, cwd]);
  const title = (model: ToolRowModel): string => (model.titleKey === null ? model.title : t(model.titleKey));
  const all = [...models.values()];
  const active = all.filter((model) => model.state === "running");
  const thinking = entries.some((entry) => entry.item.type === "reasoning" && entry.streaming);
  const errors = all.filter((model) => model.state === "error").length;
  const current = active.at(-1);
  const duration = elapsedMs(turn.startedAtMs, turn.completedAtMs);
  const segments = workSegments(entries, models, memoryWrites, title);
  const renderEntry = (entry: ConversationItem): ReactNode => {
    const write = entry.item.type === "dynamicToolCall" && entry.item.tool === "memory" ? memoryWrites[entry.item.id] : undefined;
    return (
      <Fragment key={entry.item.id}>
        <ItemView entry={entry} cwd={cwd} branch={null} />
        {write !== undefined && <MemoryWriteCard write={write} />}
      </Fragment>
    );
  };
  return (
    <div className="min-w-0" data-flow="work">
      {(current !== undefined || thinking) && (
        <div className="flex items-baseline gap-2 py-2 text-xs leading-5 text-muted-foreground" role="status">
          <StateDot state="ongoing" size={12} className="shrink-0 self-center" />
          <span>{t("conversation.tool.state.running")}</span>
          <span className="min-w-0 [overflow-wrap:anywhere] opacity-80">
            {current === undefined ? t("conversation.reasoning.thinking") : [title(current), current.summary].filter(Boolean).join(" · ")}
          </span>
        </div>
      )}
      <details data-testid="turn-work-log" className="group/work min-w-0">
        <summary
          className={clsx(
            "flex w-fit max-w-full cursor-pointer list-none flex-wrap items-center gap-x-1.5 gap-y-1 rounded-md py-1 pr-1.5",
            "text-sm leading-5 text-muted-foreground transition-colors duration-150 hover:text-foreground motion-reduce:transition-none",
            "[&::-webkit-details-marker]:hidden",
            focusRing,
          )}
        >
          <span>{duration === null ? t("conversation.workLog.title") : t("conversation.workLog.worked", { duration: formatWholeSeconds(duration, t) })}</span>
          {all.length > 0 && <span aria-hidden>·</span>}
          {all.length > 0 && <span>{t("conversation.workLog.tools", { count: all.length })}</span>}
          {errors > 0 && (
            <Badge variant="destructive" icon={<CircleX aria-hidden />}>
              {t("conversation.workLog.errors", { count: errors })}
            </Badge>
          )}
          <ChevronRight className="size-3.5 shrink-0 transition-transform duration-150 group-open/work:rotate-90 motion-reduce:transition-none" aria-hidden />
        </summary>
        <div className="mt-1 ml-1.5 flex min-w-0 flex-col gap-1.5 border-0 border-l border-solid border-border pl-3">
          {segments.map((segment) =>
            segment.kind === "item" ? renderEntry(segment.entry) : (
              <div key={segment.key} className="flex min-w-0 flex-col gap-0.5" role="group" data-testid="work-log-group"
                aria-label={t("conversation.workLog.group", { title: segment.label, count: segment.entries.length })}>
                <span className="text-xs leading-5 text-muted-foreground" aria-hidden>
                  {t("conversation.workLog.group", { title: segment.label, count: segment.entries.length })}
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">{segment.entries.map(renderEntry)}</div>
              </div>
            ),
          )}
        </div>
      </details>
    </div>
  );
}

function TurnErrorRow({ error, retrying }: { error: TurnError | null; retrying: boolean }) {
  const t = useT();
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  const details = typeof error?.additionalDetails === "string" ? error.additionalDetails.trim() : "";
  const Icon = retrying ? TriangleAlert : CircleAlert;
  return (
    <div
      className={clsx(
        "flex min-w-0 items-start gap-2.5 rounded-lg border border-solid px-3 py-2.5 text-sm leading-5",
        retrying ? "border-warning/40 bg-warning/10" : "border-destructive-foreground/30 bg-destructive",
      )}
      data-testid={TESTID.turnError}
      role="status"
      data-retrying={retrying || undefined}
      data-flow="error"
    >
      <Icon className={clsx("mt-0.5 size-4 shrink-0", retrying ? "text-warning" : "text-destructive-foreground")} aria-hidden />
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <span className={clsx("mr-1.5 font-semibold", retrying ? "text-foreground" : "text-destructive-foreground")}>
          {t(retrying ? "conversation.turn.retrying" : "conversation.turn.error")}
        </span>
        <span className="text-foreground">{message === "" ? t("conversation.turn.errorUnknown") : message}</span>
        {details !== "" && <span className="mt-0.5 block whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{details}</span>}
      </div>
    </div>
  );
}

/**
 * One turn in item order; memoized on the turn object, and each item on its ConversationItem, so a delta re-renders
 * only its item. With `branch`, user messages can be edited, and the `last` turn offers to regenerate its answer.
 */
export const TurnView = memo(function TurnView({
  turn,
  cwd,
  branch = null,
  last = false,
  notices = NO_NOTICES,
  memoryWrites = NO_WRITES,
  tasks = NO_TASKS,
  turns = NO_TURNS,
  tasksLive = false,
}: {
  turn: ConversationTurn;
  cwd: string | null;
  branch?: BranchContext | null;
  last?: boolean;
  /** omo's special messages recorded in this turn, placed after `afterItems` items. */
  notices?: readonly SessionNotice[];
  memoryWrites?: Readonly<Record<string, MemoryWriteNotice>>;
  /** Native same-parent roster only; timestamps must be compared against every turn. */
  tasks?: readonly (LiveTask | HistoricalTask)[];
  turns?: readonly ConversationTurn[];
  tasksLive?: boolean;
}) {
  const t = useT();
  const failed = turn.error !== null || turn.status === "failed";
  const prompt = turn.items.find((entry) => entry.item.type === "userMessage")?.item;
  const turnBranch = useMemo<TurnBranch | null>(() => (branch === null ? null : { ...branch, turnId: turn.id }), [branch, turn.id]);
  const work = useMemo(() => workLogEntries(turn.items).filter(entry => memoryWrites[entry.item.id] === undefined), [turn.items, memoryWrites]);
  const workIds = useMemo(() => new Set(work.map((entry) => entry.item.id)), [work]);
  const subagents = useMemo(() => turnSubagents(turn, turns, tasks), [turn, turns, tasks]);
  const answer = completedAnswer(turn);
  const files = useMemo(() => (turn.status === "inProgress" ? [] : editedFiles(turn.items, cwd)), [turn.items, turn.status, cwd]);
  const regenerate = turnBranch !== null && last && turn.status !== "inProgress" && prompt?.type === "userMessage"
    ? <RegenerateButton at={turnBranch} item={prompt} disabled={!turnBranch.idle} />
    : null;
  return (
    <div
      className={clsx(
        "flex min-w-0 flex-col gap-2",
        "[&>[data-flow=assistant]]:my-1 [&>[data-flow=plan]]:my-1 [&>[data-flow=files]]:mt-1",
        "[&>[data-flow=user]]:mb-2 [&>[data-flow=user]:not(:first-child)]:mt-2",
      )}
      data-testid={TESTID.turn}
      data-turn-id={turn.id}
      data-status={turn.status}
    >
      {turn.items.map((entry, index) => {
        const write = memoryWrites[entry.item.id];
        return (
          <Fragment key={entry.item.id}>
            {notices.filter((notice) => notice.afterItems === index).map((notice) => <NoticeRow key={notice.id} notice={notice} />)}
            {write !== undefined && <MemoryWriteCard write={write} />}
            {entry === work[0] && <WorkLog entries={work} turn={turn} cwd={cwd} memoryWrites={memoryWrites} />}
            {!workIds.has(entry.item.id) && memoryWrites[entry.item.id] === undefined && <ItemView entry={entry} cwd={cwd} branch={turnBranch} />}
            {entry === answer && entry.item.type === "agentMessage" && (
              <>
                {files.length > 0 && <EditedFilesCard files={files} />}
                <AnswerFooter text={entry.item.text} completedAt={answerCompletedAt(turn, entry)}>{regenerate}</AnswerFooter>
              </>
            )}
          </Fragment>
        );
      })}
      {notices.filter((notice) => notice.afterItems >= turn.items.length).map((notice) => <NoticeRow key={notice.id} notice={notice} />)}
      {answer === null && files.length > 0 && <EditedFilesCard files={files} />}
      {subagents.length > 0 && (
        <section className="min-w-0 rounded-lg border border-solid border-border px-3 py-2 text-xs leading-5" data-testid="turn-subagents" aria-label={t("conversation.subagents.title")}>
          <span className="text-muted-foreground [overflow-wrap:anywhere]">{t("conversation.subagents.title")}</span>
          <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">{subagents.map((task) => <SubagentRow key={task.task_id} task={task} live={tasksLive} />)}</ul>
        </section>
      )}
      {failed && <TurnErrorRow error={turn.error} retrying={turn.status === "inProgress"} />}
      {turn.status === "interrupted" && <span className="self-start rounded-sm bg-muted px-1.5 text-xs leading-5 text-muted-foreground">{t("conversation.turn.stopped")}</span>}
      {answer === null && regenerate !== null && <div className="flex">{regenerate}</div>}
    </div>
  );
}, (previous, next) => {
  // Roster ownership depends on turn windows, not the other turns' streamed items.
  // A new turns array on every delta must not redraw all settled work logs.
  const before = previous.turns ?? NO_TURNS;
  const after = next.turns ?? NO_TURNS;
  return previous.turn === next.turn && previous.cwd === next.cwd && previous.branch === next.branch &&
    previous.last === next.last && previous.notices === next.notices && previous.memoryWrites === next.memoryWrites &&
    previous.tasks === next.tasks && previous.tasksLive === next.tasksLive && before.length === after.length &&
    before.every((turn, index) => turn.id === after[index]?.id && turn.startedAtMs === after[index]?.startedAtMs &&
      turn.completedAtMs === after[index]?.completedAtMs && turn.status === after[index]?.status);
});
