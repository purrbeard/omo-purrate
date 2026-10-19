import { useEffect, useMemo, useState } from "react";
import { GitBranch } from "lucide-react";
import type { DagActivity, DagNode, DagRun } from "../../../shared/protocol";
import { useT, type MessageKey, type Translate } from "../../i18n";
import { selectDagRuns, selectTasks, selectThreadLiveState, type ConversationTurn } from "../../state";
import { useActions, useAppSelector } from "../app-context";
import { TESTID } from "../testids";
import {
  currentTodo, groupNodesByDependency, isHistoricalTask, isSuspended, knownNodeState, knownRunStatus, knownTaskStatus,
  nodeActivityLine, nodeDot, nodeElapsedMs, runDot, taskActivityLine, taskDot, taskElapsedMs, taskExcerpt,
  taskForest, taskRoute, taskTitle, todoCounts, todoDot, waitingWork, workSummary,
  type NodeState, type RunStatus, type TaskStatus, type TaskTree,
} from "./activity-model";
import { formatDuration } from "./format";
import { useTaskWork } from "./use-task-work";
import { WorkflowGraph } from "./WorkflowGraph";
import { turnSubagents } from "./work-log";
import { StateDot } from "../kit";

const EMPTY_TURNS: ConversationTurn[] = [];

/**
 * Classes per panel part. The docked layout keys off the panel's data-docked (group/panel); rows and
 * summaries use an inset focus ring because they sit flush inside a scroll container.
 */
const C = {
  toggle: "m-0 inline-flex h-[26px] flex-none cursor-pointer items-center gap-1.5 rounded-[var(--dsw-radius-md)] border-[0.5px] border-solid border-border bg-transparent px-2 [font-family:inherit] text-xs whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground data-open:bg-accent data-open:text-foreground outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
  toggleIcon: "size-3.5 text-muted-foreground",
  toggleCount: "text-muted-foreground tabular-nums",
  failureCount: "flex min-w-0 items-center gap-1.5 overflow-hidden text-destructive-foreground",
  panel: "group/panel flex min-h-0 flex-[0_1_auto] px-5 pt-2.5 data-docked:p-3 max-[900px]:px-3",
  inner: "mx-auto box-border flex max-h-[min(400px,46vh)] w-full max-w-[var(--dsh-chat-content-width,760px)] min-w-0 min-h-0 flex-[0_1_auto] flex-col gap-2 overflow-auto rounded-[var(--dsw-radius-lg)] border-[0.5px] border-solid border-border bg-background px-3 py-2.5 text-xs leading-[18px] group-data-docked/panel:max-h-none group-data-docked/panel:overflow-visible group-data-docked/panel:rounded-none group-data-docked/panel:border-0 group-data-docked/panel:p-0",
  section: "min-w-0",
  overview: "flex flex-wrap gap-2 border-0 border-b border-solid border-border pb-2 text-muted-foreground tabular-nums",
  runOverview: "flex flex-wrap gap-2 p-2 text-[11px] text-muted-foreground tabular-nums",
  sectionTitle: "m-0 text-[11px] font-medium text-muted-foreground",
  waveTitle: "m-0 block pl-2 text-[11px] font-medium text-muted-foreground",
  freshness: "m-0 text-[11px] font-medium text-muted-foreground",
  empty: "m-0 text-[11px] font-medium text-muted-foreground",
  run: "group/run min-w-0",
  runHeader: "flex min-h-[30px] min-w-0 cursor-pointer list-none items-center gap-2 rounded-[var(--dsw-radius-md)] bg-card px-2 text-muted-foreground before:text-muted-foreground before:content-['›'] group-open/run:before:rotate-90 [&::-webkit-details-marker]:hidden outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
  runName: "min-w-0 flex-1 truncate font-[550] text-foreground",
  runCounts: "text-muted-foreground tabular-nums",
  runStatus: "text-[11px] text-muted-foreground",
  waves: "flex flex-col gap-1 pt-1.5",
  wave: "grid min-w-0 grid-cols-[18px_minmax(0,1fr)] gap-1",
  layerTitle: "text-center text-[10px] leading-7 text-muted-foreground tabular-nums",
  list: "m-0 list-none p-0",
  children: "m-0 ml-3 list-none border-0 border-l-[0.5px] border-solid border-border p-0 pl-2 max-[900px]:ml-1.5 max-[900px]:pl-1",
  entity: "min-w-0",
  entityDetails: "group/entity",
  entityLine: "grid min-h-7 min-w-0 cursor-pointer list-none grid-cols-[14px_minmax(110px,1fr)_minmax(90px,.7fr)_56px_minmax(130px,1.25fr)_10px] items-center gap-1.5 rounded-[var(--dsw-radius-sm)] px-1.5 hover:bg-accent group-open/entity:bg-accent [&::-webkit-details-marker]:hidden max-[900px]:grid-cols-[12px_minmax(80px,.8fr)_minmax(60px,.6fr)_48px_minmax(80px,1fr)_8px] max-[900px]:gap-1 group-data-docked/panel:grid-cols-[14px_minmax(0,1fr)_56px_10px] group-data-docked/panel:py-1.5 max-[900px]:group-data-docked/panel:grid-cols-[14px_minmax(0,1fr)_56px_10px] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
  dotSlot: "inline-flex items-center justify-center",
  entityTitle: "min-w-0 truncate font-medium text-foreground",
  dependencies: "text-[11px] font-normal text-muted-foreground",
  route: "flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-ellipsis whitespace-nowrap text-muted-foreground group-data-docked/panel:col-start-2 group-data-docked/panel:row-start-2",
  agentLabel: "min-w-0 truncate",
  modelLabel: "flex-none",
  elapsed: "text-right text-[11px] whitespace-nowrap text-muted-foreground tabular-nums group-data-docked/panel:col-start-3 group-data-docked/panel:row-start-1",
  activity: "flex min-w-0 items-center gap-1.5 overflow-hidden text-muted-foreground group-data-docked/panel:col-[2/4] group-data-docked/panel:row-start-3",
  activityError: "flex min-w-0 items-center gap-1.5 overflow-hidden text-destructive-foreground group-data-docked/panel:col-[2/4] group-data-docked/panel:row-start-3",
  progress: "flex-none text-muted-foreground tabular-nums",
  activityText: "min-w-0 truncate",
  entityChevron: "text-muted-foreground group-open/entity:rotate-90 group-data-docked/panel:col-start-4 group-data-docked/panel:row-start-1",
  entityBody: "px-5 pt-1 pb-2",
  meta: "m-0 mb-1 [overflow-wrap:anywhere] text-muted-foreground",
  detail: "m-0 mb-1 [overflow-wrap:anywhere] text-muted-foreground",
  error: "m-0 mb-1 [overflow-wrap:anywhere] text-destructive-foreground",
  result: "m-0 mb-1 [overflow-wrap:anywhere] text-muted-foreground",
  todoPhase: "mt-1.5",
  step: "flex min-h-[22px] items-center gap-2 text-muted-foreground",
  childToggle: "ml-[26px] cursor-pointer border-0 bg-transparent px-1 py-0.5 [font-family:inherit] text-[11px] text-muted-foreground outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
  legend: "grid grid-cols-[minmax(130px,1fr)_minmax(90px,.7fr)_56px_minmax(130px,1.25fr)] gap-1.5 pr-[22px] pl-[26px] text-[10px] text-muted-foreground [&>:nth-child(3)]:text-right max-[900px]:grid-cols-[minmax(98px,.8fr)_minmax(60px,.6fr)_48px_minmax(80px,1fr)] max-[900px]:gap-1 group-data-docked/panel:hidden",
} as const;

const NODE_LABELS = {
  pending: "activity.node.pending", blocked: "activity.node.blocked", scheduled: "activity.node.scheduled",
  running: "activity.node.running", completed: "activity.node.completed", failed: "activity.node.failed",
  cancelled: "activity.node.cancelled", skipped: "activity.node.skipped",
} as const satisfies Record<NodeState, MessageKey>;
const RUN_LABELS = {
  pending: "activity.runStatus.pending", running: "activity.runStatus.running", paused: "activity.runStatus.paused",
  completed: "activity.runStatus.completed", failed: "activity.runStatus.failed", cancelled: "activity.runStatus.cancelled",
} as const satisfies Record<RunStatus, MessageKey>;
const TASK_LABELS = {
  pending: "activity.task.pending", running: "activity.task.running", completed: "activity.task.completed",
  error: "activity.task.error", cancelled: "activity.task.cancelled", interrupted: "activity.task.interrupted", lost: "activity.task.lost",
} as const satisfies Record<TaskStatus, MessageKey>;

function nodeLabel(state: string, t: Translate): string {
  const known = knownNodeState(state);
  return known === null ? state : t(NODE_LABELS[known]);
}
function taskLabel(status: string, t: Translate): string {
  const known = knownTaskStatus(status);
  return known === null ? status : t(TASK_LABELS[known]);
}
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

/** Collapsed by the conversation owner; no chip for an empty roster. Linked tasks count only once. */
export function ActivityToggle({ threadId, open, controlsId, onToggle }: {
  threadId: string; open: boolean; controlsId: string; onToggle: () => void;
}) {
  const t = useT();
  const runs = useAppSelector((state) => selectDagRuns(state, threadId));
  const tasks = useAppSelector((state) => selectTasks(state, threadId));
  const freshness = useAppSelector((state) => selectThreadLiveState(state, threadId)?.freshness ?? "unattached");
  const hasStoredWork = useAppSelector(state => state.threadLinks.some(link => link.parentId === threadId && link.taskId !== undefined));
  const { done, failed, running, total } = workSummary(runs, tasks, freshness === "live");
  if (total === 0 && runs.length === 0 && !hasStoredWork) return null;
  const label = [t("activity.chipDone", { done, total }), ...(failed > 0 ? [t("activity.chipFailed", { failed })] : [])].join(" · ");
  return (
    <button type="button" className={C.toggle} data-testid={TESTID.omoActivityToggle} data-freshness={freshness}
      data-open={open ? "" : undefined} aria-expanded={open} aria-controls={open ? controlsId : undefined}
      aria-label={`${t("activity.region")}: ${label}`} onClick={onToggle}>
      <GitBranch className={C.toggleIcon} aria-hidden />
      <span>{t("activity.toggle")}</span>
      <span className={C.toggleCount}>{t("activity.chipDone", { done, total })}</span>
      {failed > 0 && <span className={C.failureCount}>{t("activity.chipFailed", { failed })}</span>}
      {running > 0 && <StateDot state="ongoing" size={10} />}
    </button>
  );
}

/** One line per work entity; todos, full model, result and prompt are available without crowding the overview. */
function WorkRow({ tree, node, activity, dependencies = [], live, now, depth = 0, expanded }: {
  tree?: TaskTree; node?: DagNode; activity?: DagActivity; dependencies?: string[]; live: boolean; now: number; depth?: number; expanded?: boolean;
}) {
  const t = useT();
  const task = tree?.task;
  const work = tree?.work;
  const actions = useActions();
  const childId = task !== undefined && !isHistoricalTask(task) ? task.child_session_id ?? work?.task.child_session_id : work?.task.child_session_id;
  const child = useAppSelector(state => childId === undefined ? undefined : state.threads[childId]);
  const historical = task !== undefined && isHistoricalTask(task);
  const executing = live && !historical && (task === undefined || !isSuspended(task));
  const status = node?.state ?? task?.status ?? "pending";
  const label = node === undefined ? task === undefined ? "" : taskTitle(task) : node.label?.trim() || node.id;
  const route = task === undefined ? [] : taskRoute(task);
  const duration = node === undefined ? task === undefined ? null : taskElapsedMs(task, now, executing) :
    nodeElapsedMs(node, now, executing);
  const elapsed = duration ?? (task === undefined || historical ? null :
    task.status === "running" && executing ? Math.max(0, now - Date.parse(task.created_at)) : task.run_stats?.runtime_ms ?? null);
  const phases = work?.todo?.phases ?? [];
  const counts = todoCounts(phases);
  const todo = counts.total > 0 ? `${counts.done}/${counts.total}` : null;
  const current = currentTodo(phases);
  const line = node === undefined ? task === undefined ? null : taskActivityLine(task) :
    nodeActivityLine(node, activity ?? null, task);
  const result = task === undefined ? null : taskExcerpt(task);
  const error = node?.last_error?.message ?? (result?.kind === "error" ? result.text : null);
  const detail = error ?? (current === null ? line ?? work?.activity ?? (result?.text ?? null) : t("activity.now", { activity: current }));
  const children = tree?.children ?? [];
  const [childrenOpen, setChildrenOpen] = useState(depth < 2);
  const fullRoute = route.join(" · ");
  const model = task?.model?.split("/").at(-1);
  const agent = task?.category ?? task?.agent_type;
  const statusText = node === undefined ? taskLabel(status, t) : nodeLabel(status, t);
  return (
    <li className={C.entity} data-testid={node === undefined ? TESTID.omoTask : TESTID.dagNode}
      data-node-id={node?.id} data-task-id={task?.task_id} data-state={node?.state} data-status={task?.status}
      data-source={historical ? "history" : "live"} data-depth={depth}>
      <details className={C.entityDetails} open={expanded}>
        <summary className={C.entityLine} title={[statusText, label, fullRoute, detail, node?.prompt].filter(Boolean).join("\n")}>
          <span className={C.dotSlot} title={statusText}>
            <StateDot state={node === undefined ? taskDot(status, executing) : nodeDot(status, executing)} size={10} />
          </span>
          <span className={C.entityTitle}>{label}
            {dependencies.length > 0 && <span className={C.dependencies} title={t("activity.depends", { nodes: dependencies.join(", ") })}> ← {dependencies.join(" · ")}</span>}
          </span>
          <span className={C.route} title={fullRoute}>
            {agent !== undefined && <span className={C.agentLabel}>{agent}</span>}
            {agent !== undefined && model !== undefined && <span aria-hidden>·</span>}
            {model !== undefined && <span className={C.modelLabel}>{model}</span>}
          </span>
          <span className={C.elapsed}>{elapsed !== null && Number.isFinite(elapsed) ? formatDuration(elapsed, t) : "—"}</span>
          <span className={error === null ? C.activity : C.activityError}>
            {todo !== null && <span className={C.progress} data-testid={TESTID.taskSteps}>{todo}</span>}
            <span className={C.activityText}>{detail ?? statusText}</span>
          </span>
          <span className={C.entityChevron} aria-hidden>›</span>
        </summary>
        <div className={C.entityBody}>
          {child !== undefined && <button type="button" data-testid="task-open-conversation" onClick={() => void actions.openThread(child.id)}>{t("activity.openConversation")}</button>}
          <p className={C.meta}>{[statusText, fullRoute, historical ? t("activity.task.restored") : "",
            task !== undefined && isSuspended(task) ? t("activity.task.suspended") : ""].filter(Boolean).join(" · ")}</p>
          {node !== undefined && <p className={C.meta}>{node.prompt}</p>}
          {task !== undefined && node !== undefined && <p className={C.meta}>{taskTitle(task)}</p>}
          {dependencies.length > 0 && <p className={C.meta}>{t("activity.depends", { nodes: dependencies.join(", ") })}</p>}
          {line !== null && <p className={C.detail}>{line}</p>}
          {node !== undefined && task !== undefined && <p className={C.detail}>{taskActivityLine(task)}</p>}
          {error !== null && <p className={C.error}>{error}</p>}
          {result?.kind === "result" && <p className={C.result}>{result.text}</p>}
          {phases.map((phase, index) => (
            <div key={index} className={C.todoPhase}>
              <span className={C.waveTitle}>{phase.name}</span>
              {phase.tasks.map((step, stepIndex) => (
                <div key={stepIndex} className={C.step} data-testid={TESTID.taskStep} data-status={step.status}>
                  <StateDot state={todoDot(step.status, executing)} size={10} /><span>{step.content}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </details>
      {children.length > 0 && (
        <>
          {depth >= 2 && <button className={C.childToggle} type="button" data-testid={TESTID.taskChildrenToggle}
            aria-expanded={childrenOpen} onClick={() => setChildrenOpen(!childrenOpen)}>
            {t(childrenOpen ? "activity.children.hide" : "activity.children.show", { count: children.length })}
          </button>}
          {childrenOpen && <ul className={C.children}>
            {children.map((child) => <WorkRow key={child.task.task_id} tree={child} live={live} now={now} depth={depth + 1} />)}
          </ul>}
        </>
      )}
    </li>
  );
}

function RunCard({ run, live, restored = false, activity, trees, now, view }: {
  run: DagRun; live: boolean; restored?: boolean; activity: Record<string, DagActivity> | undefined; trees: TaskTree[]; now: number; view: "list" | "graph";
}) {
  const t = useT();
  const groups = useMemo(() => groupNodesByDependency(run), [run]);
  const summary = workSummary([run], [], live);
  const knownStatus = knownRunStatus(run.status);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedNode = run.nodes.find(node => node.id === selected);
  const waves = [...run.waves].sort((a, b) => a.index - b.index);
  const activeWave = waves.find(wave => wave.node_ids.some(id => run.nodes.some(node => node.id === id && node.state === "running")));
  const started = Date.parse(run.created_at);
  const ended = Date.parse(run.completed_at ?? run.updated_at);
  const elapsed = Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, (live && run.status === "running" ? now : ended) - started) : null;
  return (
    <details className={C.run} open={run.status !== "completed"} data-testid={TESTID.dagRun} data-run-id={run.run_id} data-status={run.status} data-source={restored ? "history" : "live"}>
      <summary className={C.runHeader}>
        <StateDot state={runDot(run.status, live)} size={10} />
        <span className={C.runName}>{run.name}</span>
        <span className={C.runCounts}>{t("activity.chipDone", summary)}{summary.failed > 0 && ` · ${t("activity.chipFailed", summary)}`}</span>
        <span className={C.runStatus}>{knownStatus === null ? run.status : t(RUN_LABELS[knownStatus])}{restored && ` · ${t("activity.task.restored")}`}</span>
      </summary>
      <div className={C.runOverview}>
        {activeWave !== undefined && <span>{t("activity.run.wave", { index: activeWave.index + 1 })} / {waves.length}</span>}
        <span>{t("activity.running", { count: summary.running })}</span>
        <span>{t("activity.waiting", { count: waitingWork([run], []) })}</span>
        {elapsed !== null && <span>{formatDuration(elapsed, t)}</span>}
      </div>
      {view === "graph" ? <>
        <WorkflowGraph run={run} live={live} now={now} onSelect={setSelected} />
        {selectedNode !== undefined && <div className={C.entityBody} data-testid="workflow-node-detail">
          <strong>{selectedNode.label?.trim() || selectedNode.id}</strong>
          <p className={C.meta}>{nodeLabel(selectedNode.state, t)}</p>
          {selectedNode.depends_on.length > 0 && <p className={C.meta}>{t("activity.depends", { nodes: selectedNode.depends_on.join(", ") })}</p>}
        </div>}
      </> : <div className={C.waves}>
        {groups.map((group) => (
          <div key={group.index ?? "rest"} className={C.wave}>
            <span className={C.layerTitle} title={t("activity.layer")}>{group.index === null ? "—" : group.index + 1}</span>
            <ul className={C.list}>
              {group.nodes.map((node) => <WorkRow key={node.id} node={node}
                tree={trees.find((tree) => tree.task.task_id === node.task_id)} live={live} now={now}
                activity={activity?.[node.id]} dependencies={[...new Set([...node.depends_on, ...run.edges.filter((edge) => edge.to === node.id).map((edge) => edge.from)])]} />)}
            </ul>
          </div>
        ))}
      </div>}
    </details>
  );
}

/** Compact waves and ownership trees, with child todo checkpoints read only while the panel is inspected. */
export function ActivityPanel({ threadId, id, view = "list", docked = false }: { threadId: string; id: string; view?: "list" | "graph"; docked?: boolean }) {
  const t = useT();
  const error = useTaskWork(threadId);
  const live = useAppSelector((state) => selectThreadLiveState(state, threadId));
  const runs = useAppSelector((state) => selectDagRuns(state, threadId));
  const tasks = useAppSelector((state) => selectTasks(state, threadId));
  const turns = useAppSelector(state => state.conversations[threadId]?.turns ?? EMPTY_TURNS);
  const isLive = live?.freshness === "live";
  const trees = useMemo(() => taskForest(tasks, live?.taskWork ?? []), [tasks, live?.taskWork]);
  const linked = new Set(runs.flatMap((run) => run.nodes.map((node) => node.task_id)));
  const standalone = trees.filter((tree) => !linked.has(tree.task.task_id));
  const taskGroups = useMemo(() => {
    const assigned = new Set<string>();
    const groups = turns.flatMap((turn, index) => {
      const owned = new Set(turnSubagents(turn, turns, tasks).map(task => task.task_id));
      const receipts = new Map(live?.historicalTasks.map(task => [task.task_id, task.turn_id]) ?? []);
      const members = standalone.filter(tree => {
        const receiptTurn = receipts.get(tree.task.task_id);
        return receiptTurn === undefined ? owned.has(tree.task.task_id) : receiptTurn === turn.id;
      });
      for (const tree of members) assigned.add(tree.task.task_id);
      const message = turn.items.find(item => item.item.type === "userMessage")?.item;
      const title = message?.type === "userMessage" ? message.content.flatMap(part => part.type === "text" ? [part.text] : []).join(" ") : "";
      return members.length === 0 ? [] : [{ id: turn.id, index: index + 1, title, members }];
    }).reverse();
    const unknown = standalone.filter(tree => !assigned.has(tree.task.task_id));
    if (unknown.length > 0) groups.push({ id: "unknown", index: 0, title: "", members: unknown });
    return groups;
  }, [turns, tasks, standalone, live?.historicalTasks]);
  const now = useNow(isLive && (tasks.some((task) => task.status === "running" && !isHistoricalTask(task) && !isSuspended(task)) ||
    runs.some((run) => run.status === "running") || live.taskWork.some((work) => work.task.status === "running" && !isSuspended(work.task))));
  if (live === null) return null;
  const summary = workSummary(runs, view === "graph" ? [] : tasks, isLive);
  return (
    <section id={id} className={C.panel} data-docked={docked || undefined} data-testid={TESTID.omoActivity} data-freshness={live.freshness} aria-label={t("activity.region")}>
      <div className={C.inner}>
        <div className={C.overview} data-testid="workflow-summary"><span>{t("activity.chipDone", summary)}</span><span>{t("activity.running", { count: summary.running })}</span><span>{t("activity.waiting", { count: waitingWork(runs, tasks) })}</span>{summary.failed > 0 && <span className={C.failureCount}>{t("activity.chipFailed", summary)}</span>}</div>
        {!isLive && <p className={C.freshness} role="status">{t(live.freshness === "stale" ? "activity.freshness.stale" : "activity.freshness.unattached")}</p>}
        {error !== null && <p className={C.error} role="status">{t("activity.children.error")} <span title={error}>{error}</span></p>}
        {summary.total === 0 && <p className={C.empty}>{t(view === "graph" ? "activity.graph.empty" : "activity.empty")}</p>}
        {view === "list" && <div className={C.legend} aria-hidden><span>{t("activity.column.work")}</span><span>{t("activity.column.agent")}</span><span>{t("activity.column.time")}</span><span>{t("activity.column.step")}</span></div>}
        {runs.map((run) => <RunCard key={run.run_id} run={run} live={isLive && live.runsSource === "live"} restored={live.runsSource === "history"} activity={live.dagActivity[run.run_id]} trees={trees} now={now} view={view} />)}
        {view === "list" && standalone.length > 0 && <section className={C.section}>
          <h2 className={C.sectionTitle}>{t("activity.tasks")}</h2>
          {taskGroups.map(group => <details key={group.id} data-testid="workflow-task-group" data-turn-id={group.id} open={group === taskGroups[0]}>
            <summary title={group.title}>{group.index === 0 ? t("activity.group.unknown") : t("activity.group.turn", { index: group.index })} · {group.members.length}{group.title !== "" && ` · ${group.title.slice(0, 90)}`}</summary>
            <ul className={C.list}>{group.members.map(tree => <WorkRow key={tree.task.task_id} tree={tree} live={isLive} now={now} />)}</ul>
          </details>)}
        </section>}
        {live.truncatedRuns !== undefined && live.truncatedRuns > 0 && <p className={C.empty}>{t("activity.runs.truncated", { count: live.truncatedRuns })}</p>}
        {live.truncatedTasks !== undefined && live.truncatedTasks > 0 && <p className={C.empty}>{t("activity.tasks.truncated", { count: live.truncatedTasks })}</p>}
      </div>
    </section>
  );
}
