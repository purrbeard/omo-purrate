import { useEffect, useMemo, useState } from "react";
import { IconBranchOutlineRegular, StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import type { DagActivity, DagNode, DagRun } from "../../../shared/protocol";
import { useT, type MessageKey, type Translate } from "../../i18n";
import { selectDagRuns, selectTasks, selectThreadLiveState } from "../../state";
import { useAppSelector } from "../app-context";
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
import css from "./ActivityPanel.module.css";

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
  if (total === 0 && !hasStoredWork) return null;
  const label = [t("activity.chipDone", { done, total }), ...(failed > 0 ? [t("activity.chipFailed", { failed })] : [])].join(" · ");
  return (
    <button type="button" className={css.toggle} data-testid={TESTID.omoActivityToggle} data-freshness={freshness}
      data-open={open ? "" : undefined} aria-expanded={open} aria-controls={open ? controlsId : undefined}
      aria-label={`${t("activity.region")}: ${label}`} onClick={onToggle}>
      <IconBranchOutlineRegular size={14} className={css.toggleIcon} />
      <span>{t("activity.toggle")}</span>
      <span className={css.toggleCount}>{t("activity.chipDone", { done, total })}</span>
      {failed > 0 && <span className={css.failureCount}>{t("activity.chipFailed", { failed })}</span>}
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
  const historical = task !== undefined && isHistoricalTask(task);
  const executing = live && !historical && (task === undefined || !isSuspended(task));
  const status = node?.state ?? task?.status ?? "pending";
  const label = node === undefined ? task === undefined ? "" : taskTitle(task) : node.label?.trim() || node.id;
  const route = task === undefined ? [] : taskRoute(task);
  const duration = node === undefined ? task === undefined ? null : taskElapsedMs(task, now) :
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
    <li className={css.entity} data-testid={node === undefined ? TESTID.omoTask : TESTID.dagNode}
      data-node-id={node?.id} data-task-id={task?.task_id} data-state={node?.state} data-status={task?.status}
      data-source={historical ? "history" : "live"} data-depth={depth}>
      <details className={css.entityDetails} open={expanded}>
        <summary className={css.entityLine} title={[statusText, label, fullRoute, detail, node?.prompt].filter(Boolean).join("\n")}>
          <span className={css.dotSlot} title={statusText}>
            <StateDot state={node === undefined ? taskDot(status, executing) : nodeDot(status, executing)} size={10} />
          </span>
          <span className={css.entityTitle}>{label}
            {dependencies.length > 0 && <span className={css.dependencies} title={t("activity.depends", { nodes: dependencies.join(", ") })}> ← {dependencies.join(" · ")}</span>}
          </span>
          <span className={css.route} title={fullRoute}>
            {agent !== undefined && <span className={css.agentLabel}>{agent}</span>}
            {agent !== undefined && model !== undefined && <span aria-hidden>·</span>}
            {model !== undefined && <span className={css.modelLabel}>{model}</span>}
          </span>
          <span className={css.elapsed}>{elapsed !== null && Number.isFinite(elapsed) ? formatDuration(elapsed, t) : "—"}</span>
          <span className={error === null ? css.activity : css.failureCount}>
            {todo !== null && <span className={css.progress} data-testid={TESTID.taskSteps}>{todo}</span>}
            <span className={css.activityText}>{detail ?? statusText}</span>
          </span>
          <span className={css.entityChevron} aria-hidden>›</span>
        </summary>
        <div className={css.entityBody}>
          <p className={css.meta}>{[statusText, fullRoute, historical ? t("activity.task.restored") : "",
            task !== undefined && isSuspended(task) ? t("activity.task.suspended") : ""].filter(Boolean).join(" · ")}</p>
          {node !== undefined && <p className={css.meta}>{node.prompt}</p>}
          {task !== undefined && node !== undefined && <p className={css.meta}>{taskTitle(task)}</p>}
          {dependencies.length > 0 && <p className={css.meta}>{t("activity.depends", { nodes: dependencies.join(", ") })}</p>}
          {line !== null && <p className={css.detail}>{line}</p>}
          {node !== undefined && task !== undefined && <p className={css.detail}>{taskActivityLine(task)}</p>}
          {error !== null && <p className={css.error}>{error}</p>}
          {result?.kind === "result" && <p className={css.result}>{result.text}</p>}
          {phases.map((phase, index) => (
            <div key={index} className={css.todoPhase}>
              <span className={css.waveTitle}>{phase.name}</span>
              {phase.tasks.map((step, stepIndex) => (
                <div key={stepIndex} className={css.step} data-testid={TESTID.taskStep} data-status={step.status}>
                  <StateDot state={todoDot(step.status, executing)} size={10} /><span>{step.content}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </details>
      {children.length > 0 && (
        <>
          {depth >= 2 && <button className={css.childToggle} type="button" data-testid={TESTID.taskChildrenToggle}
            aria-expanded={childrenOpen} onClick={() => setChildrenOpen(!childrenOpen)}>
            {t(childrenOpen ? "activity.children.hide" : "activity.children.show", { count: children.length })}
          </button>}
          {childrenOpen && <ul className={css.children}>
            {children.map((child) => <WorkRow key={child.task.task_id} tree={child} live={live} now={now} depth={depth + 1} />)}
          </ul>}
        </>
      )}
    </li>
  );
}

function RunCard({ run, live, activity, trees, now, view }: {
  run: DagRun; live: boolean; activity: Record<string, DagActivity> | undefined; trees: TaskTree[]; now: number; view: "list" | "graph";
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
    <details className={css.run} open={run.status !== "completed"} data-testid={TESTID.dagRun} data-run-id={run.run_id} data-status={run.status}>
      <summary className={css.runHeader}>
        <StateDot state={runDot(run.status, live)} size={10} />
        <span className={css.runName}>{run.name}</span>
        <span className={css.runCounts}>{t("activity.chipDone", summary)}{summary.failed > 0 && ` · ${t("activity.chipFailed", summary)}`}</span>
        <span className={css.runStatus}>{knownStatus === null ? run.status : t(RUN_LABELS[knownStatus])}</span>
      </summary>
      <div className={css.runOverview}>
        {activeWave !== undefined && <span>{t("activity.run.wave", { index: activeWave.index + 1 })} / {waves.length}</span>}
        <span>{t("activity.running", { count: summary.running })}</span>
        <span>{t("activity.waiting", { count: waitingWork([run], []) })}</span>
        {elapsed !== null && <span>{formatDuration(elapsed, t)}</span>}
      </div>
      {view === "graph" ? <>
        <WorkflowGraph run={run} live={live} now={now} onSelect={setSelected} />
        {selectedNode !== undefined && <ul className={css.list} key={selectedNode.id}>
          <WorkRow node={selectedNode} tree={trees.find(tree => tree.task.task_id === selectedNode.task_id)} live={live} now={now}
            activity={activity?.[selectedNode.id]} expanded dependencies={[...new Set([...selectedNode.depends_on, ...run.edges.filter(edge => edge.to === selectedNode.id).map(edge => edge.from)])]} />
        </ul>}
      </> : <div className={css.waves}>
        {groups.map((group) => (
          <div key={group.index ?? "rest"} className={css.wave}>
            <span className={css.layerTitle} title={t("activity.layer")}>{group.index === null ? "—" : group.index + 1}</span>
            <ul className={css.list}>
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
  const isLive = live?.freshness === "live";
  const trees = useMemo(() => taskForest(tasks, live?.taskWork ?? []), [tasks, live?.taskWork]);
  const linked = new Set(runs.flatMap((run) => run.nodes.map((node) => node.task_id)));
  const standalone = trees.filter((tree) => !linked.has(tree.task.task_id));
  const now = useNow(isLive && (tasks.some((task) => task.status === "running") ||
    runs.some((run) => run.status === "running") || live.taskWork.some((work) => work.task.status === "running")));
  if (live === null) return null;
  const summary = workSummary(runs, tasks, isLive);
  return (
    <section id={id} className={css.panel} data-docked={docked || undefined} data-testid={TESTID.omoActivity} data-freshness={live.freshness} aria-label={t("activity.region")}>
      <div className={css.inner}>
        <div className={css.overview} data-testid="workflow-summary"><span>{t("activity.chipDone", summary)}</span><span>{t("activity.running", { count: summary.running })}</span><span>{t("activity.waiting", { count: waitingWork(runs, tasks) })}</span>{summary.failed > 0 && <span className={css.failureCount}>{t("activity.chipFailed", summary)}</span>}</div>
        {!isLive && <p className={css.freshness} role="status">{t(live.freshness === "stale" ? "activity.freshness.stale" : "activity.freshness.unattached")}</p>}
        {error !== null && <p className={css.error} role="status">{t("activity.children.error")} <span title={error}>{error}</span></p>}
        {summary.total === 0 && <p className={css.empty}>{t("activity.empty")}</p>}
        {view === "list" && <div className={css.legend} aria-hidden><span>{t("activity.column.work")}</span><span>{t("activity.column.agent")}</span><span>{t("activity.column.time")}</span><span>{t("activity.column.step")}</span></div>}
        {runs.map((run) => <RunCard key={run.run_id} run={run} live={isLive} activity={live.dagActivity[run.run_id]} trees={trees} now={now} view={view} />)}
        {standalone.length > 0 && <section className={css.section}>
          <h2 className={css.sectionTitle}>{t("activity.tasks")}</h2>
          <ul className={css.list}>{standalone.map((tree) => <WorkRow key={tree.task.task_id} tree={tree} live={isLive} now={now} />)}</ul>
        </section>}
        {live.truncatedRuns !== undefined && live.truncatedRuns > 0 && <p className={css.empty}>{t("activity.runs.truncated", { count: live.truncatedRuns })}</p>}
        {live.truncatedTasks !== undefined && live.truncatedTasks > 0 && <p className={css.empty}>{t("activity.tasks.truncated", { count: live.truncatedTasks })}</p>}
      </div>
    </section>
  );
}
