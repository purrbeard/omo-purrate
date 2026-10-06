import type { HistoricalTask, TaskWork } from "../../../shared/ipc";
import type { DagActivity, DagNode, DagRun, LiveTask, TodoPhase, WireGoal } from "../../../shared/protocol";

export type ActivityTask = LiveTask | HistoricalTask;

/** Structurally the StateDot `state` prop; kept local so this module builds without the renderer's path aliases. */
export type StateDotState = "done" | "warning" | "ongoing" | "error" | "idle";

export const NODE_STATES = ["pending", "blocked", "scheduled", "running", "completed", "failed", "cancelled", "skipped"] as const;
export type NodeState = (typeof NODE_STATES)[number];
export const RUN_STATUSES = ["pending", "running", "paused", "completed", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const TASK_STATUSES = ["pending", "running", "completed", "error", "cancelled", "interrupted", "lost"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

function known<T extends string>(values: readonly T[], value: string): T | null {
  return values.find((candidate) => candidate === value) ?? null;
}

/** Narrows a wire node state to a known one; future states return null and render by their raw name. */
export function knownNodeState(state: string): NodeState | null {
  return known(NODE_STATES, state);
}
export function knownRunStatus(status: string): RunStatus | null {
  return known(RUN_STATUSES, status);
}
export function knownTaskStatus(status: string): TaskStatus | null {
  return known(TASK_STATUSES, status);
}

/** Only live running work animates; a running record from history or a lost connection is drawn static. */
export function nodeDot(state: string, live: boolean): StateDotState {
  switch (knownNodeState(state)) {
    case "running":
      return live ? "ongoing" : "idle";
    case "completed":
      return "done";
    case "failed":
      return "error";
    case "cancelled":
      return "warning";
    default:
      return "idle";
  }
}

export function runDot(status: string, live: boolean): StateDotState {
  switch (knownRunStatus(status)) {
    case "running":
      return live ? "ongoing" : "idle";
    case "completed":
      return "done";
    case "failed":
      return "error";
    case "paused":
    case "cancelled":
      return "warning";
    default:
      return "idle";
  }
}

export function taskDot(status: string, live: boolean): StateDotState {
  switch (knownTaskStatus(status)) {
    case "running":
      return live ? "ongoing" : "idle";
    case "completed":
      return "done";
    case "error":
    case "lost":
      return "error";
    case "cancelled":
    case "interrupted":
      return "warning";
    default:
      return "idle";
  }
}

export interface WaveGroup {
  /** Wave index from the snapshot; null groups the nodes no wave lists. */
  index: number | null;
  nodes: DagNode[];
}

/** Nodes in wave order, each node once; nodes missing from every wave follow in snapshot order. */
export function groupNodesByWave(run: DagRun): WaveGroup[] {
  const byId = new Map(run.nodes.map((node) => [node.id, node]));
  const placed = new Set<string>();
  const groups: WaveGroup[] = [];
  for (const wave of [...run.waves].sort((a, b) => a.index - b.index)) {
    const nodes = wave.node_ids.flatMap((id) => {
      const node = byId.get(id);
      if (node === undefined || placed.has(id)) return [];
      placed.add(id);
      return [node];
    });
    if (nodes.length > 0) groups.push({ index: wave.index, nodes });
  }
  const rest = run.nodes.filter((node) => !placed.has(node.id));
  return rest.length === 0 ? groups : [...groups, { index: null, nodes: rest }];
}

/** Topological layers include waiting nodes too; unknown/cyclic dependencies remain visibly unresolved. */
export function groupNodesByDependency(run: DagRun): WaveGroup[] {
  const remaining = new Map(run.nodes.map((node) => [node.id, node]));
  const placed = new Set<string>();
  const groups: WaveGroup[] = [];
  while (remaining.size > 0) {
    const nodes = [...remaining.values()].filter((node) => [
      ...node.depends_on, ...run.edges.filter((edge) => edge.to === node.id).map((edge) => edge.from),
    ].every((id) => placed.has(id)));
    if (nodes.length === 0) {
      groups.push({ index: null, nodes: [...remaining.values()] });
      break;
    }
    groups.push({ index: groups.length, nodes });
    for (const node of nodes) {
      remaining.delete(node.id);
      placed.add(node.id);
    }
  }
  return groups;
}

export interface StateCount {
  state: string;
  count: number;
}

/** Nonzero per-state counts in lifecycle order, unknown states last by name; derived from nodes when the snapshot has no counts. */
export function runStateCounts(run: DagRun): StateCount[] {
  const entries = Object.entries(run.counts).filter(([state]) => state !== "total");
  const counts = new Map<string, number>(entries);
  if (entries.length === 0) for (const node of run.nodes) counts.set(node.state, (counts.get(node.state) ?? 0) + 1);
  const rank = (state: string): number => {
    const index = NODE_STATES.findIndex((candidate) => candidate === state);
    return index < 0 ? NODE_STATES.length : index;
  };
  return [...counts]
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([state, count]) => ({ state, count }));
}

export function runTotal(run: DagRun): number {
  return run.counts["total"] ?? run.nodes.length;
}

export interface ActivitySummary {
  /** Running runs and live tasks; always 0 when the state is not live, and restored tasks never count. */
  running: number;
  total: number;
}

export function activitySummary(runs: readonly DagRun[], tasks: readonly ActivityTask[], live: boolean): ActivitySummary {
  const running = live
    ? runs.filter((run) => run.status === "running").length +
      tasks.filter((task) => !isHistoricalTask(task) && task.status === "running").length
    : 0;
  return { running, total: runs.length + tasks.length };
}

/** Counts work entities once: a DAG node and the task it owns are the same work. */
export function workSummary(runs: readonly DagRun[], tasks: readonly ActivityTask[], live: boolean) {
  const linked = new Set(runs.flatMap((run) => run.nodes.flatMap((node) => node.task_id === undefined ? [] : [node.task_id])));
  const states = [
    ...runs.flatMap((run) => run.nodes.map((node) => node.state)),
    ...tasks.filter((task) => !linked.has(task.task_id)).map((task) => task.status),
  ];
  return {
    total: states.length,
    done: states.filter((state) => state === "completed").length,
    failed: states.filter((state) => state === "failed" || state === "error" || state === "lost").length,
    running: live ? states.filter((state) => state === "running").length : 0,
  };
}

export interface TaskTree {
  task: ActivityTask;
  work: TaskWork | undefined;
  children: TaskTree[];
}

/** Ownership follows child_session_id -> parent_session_id, never DAG dependencies or numeric depth. */
export function taskForest(tasks: readonly ActivityTask[], work: readonly TaskWork[]): TaskTree[] {
  const byId = new Map(work.map((entry) => [entry.task.task_id, entry]));
  const records = new Map<string, ActivityTask>(work.map((entry) => [entry.task.task_id, entry.task]));
  for (const task of tasks) records.set(task.task_id, task);
  const placed = new Set<string>();
  const branch = (task: ActivityTask, ancestors: ReadonlySet<string>): TaskTree => {
    placed.add(task.task_id);
    const entry = byId.get(task.task_id);
    const sessionId = !isHistoricalTask(task) ? task.child_session_id ?? entry?.task.child_session_id : entry?.task.child_session_id;
    const seen = new Set([...ancestors, task.task_id]);
    const children = sessionId === undefined ? [] : orderTasks(work.filter((child) =>
      child.parentSessionId === sessionId && !seen.has(child.task.task_id) && !placed.has(child.task.task_id),
    ).map((child) => records.get(child.task.task_id) ?? child.task)).map((child) => branch(child, seen));
    return { task, work: entry, children };
  };
  return orderTasks(tasks).flatMap((task) => placed.has(task.task_id) ? [] : [branch(task, new Set())]);
}

/** Snapshot timestamps are ISO strings; unknown endpoints stay absent rather than inventing a duration. */
export function nodeElapsedMs(node: DagNode, now: number, live: boolean): number | null {
  if (node.started_at === undefined) return null;
  const start = Date.parse(node.started_at);
  const end = node.completed_at === undefined ? live && node.state === "running" ? now : NaN : Date.parse(node.completed_at);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
}

export function isHistoricalTask(task: ActivityTask): task is HistoricalTask {
  return "source" in task;
}

function nonEmpty(...values: (string | undefined)[]): string | null {
  for (const value of values) {
    const trimmed = value?.trim() ?? "";
    if (trimmed !== "") return trimmed;
  }
  return null;
}

export function taskTitle(task: ActivityTask): string {
  return nonEmpty(task.task_summary, task.name, isHistoricalTask(task) ? undefined : task.description) ?? task.task_id;
}

export function taskRoute(task: ActivityTask): string[] {
  return [nonEmpty(task.category, task.agent_type), nonEmpty(task.model)].filter((part): part is string => part !== null);
}

/** The TUI's rule: a task persisted on disk or detached from its RPC child is suspended, not executing. */
export function isSuspended(task: ActivityTask): boolean {
  return !isHistoricalTask(task) && (task.residency_state === "rpc_detached" || task.residency_state === "persisted_only");
}

export function taskActivityLine(task: ActivityTask): string | null {
  if (isHistoricalTask(task) || task.live_progress === undefined) return null;
  const progress = task.live_progress;
  return joinParts([progress.activity, progress.current_tool, progress.last_assistant_line]);
}

/** Running nodes only: the latest DAG activity wins, else the attached task's live progress. */
export function nodeActivityLine(node: DagNode, activity: DagActivity | null, task: ActivityTask | undefined): string | null {
  if (node.state !== "running") return null;
  if (activity !== null) return joinParts([activity.activity, activity.currentTool, activity.lastAssistantLine]);
  return task === undefined ? null : taskActivityLine(task);
}

function joinParts(parts: (string | undefined)[]): string | null {
  const present = parts.flatMap((part) => {
    const text = part?.trim() ?? "";
    return text === "" ? [] : [text];
  });
  return present.length === 0 ? null : present.join(" · ");
}

/** Live elapsed time for running tasks with progress, else the recorded runtime; null when neither is known. */
export function taskElapsedMs(task: ActivityTask, nowMs: number): number | null {
  if (isHistoricalTask(task)) return null;
  if (task.status === "running" && task.live_progress !== undefined) return Math.max(0, nowMs - task.live_progress.started_at);
  return task.run_stats?.runtime_ms ?? null;
}

export interface TaskCounters {
  turns: number | null;
  toolCalls: number | null;
}

export function taskCounters(task: ActivityTask): TaskCounters {
  if (isHistoricalTask(task)) return { turns: null, toolCalls: null };
  return {
    turns: task.live_progress?.turns ?? task.run_stats?.turns ?? null,
    toolCalls: task.live_progress?.tool_calls ?? task.run_stats?.tool_calls ?? null,
  };
}

export const EXCERPT_LIMIT = 240;

export function excerpt(text: string, limit = EXCERPT_LIMIT): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`;
}

export interface TaskExcerpt {
  kind: "error" | "result";
  text: string;
}

export function taskExcerpt(task: ActivityTask): TaskExcerpt | null {
  const error = nonEmpty(task.error_message);
  if (error !== null) return { kind: "error", text: excerpt(error) };
  const result = nonEmpty(task.final_response);
  return result === null ? null : { kind: "result", text: excerpt(result) };
}

function taskRank(task: ActivityTask): number {
  if (isHistoricalTask(task)) return 3;
  if (task.status === "running") return 0;
  if (task.status === "pending") return 1;
  return 2;
}

/** Live running, then live pending, then live settled tasks, then restored ones; input order is kept within each group. */
export function orderTasks(tasks: readonly ActivityTask[]): ActivityTask[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => taskRank(a.task) - taskRank(b.task) || a.index - b.index)
    .map(({ task }) => task);
}

export type TodoStatus = TodoPhase["tasks"][number]["status"];

export interface TodoCounts {
  done: number;
  total: number;
  inProgress: number;
  pending: number;
  abandoned: number;
}

export function todoCounts(phases: readonly TodoPhase[]): TodoCounts {
  const counts: TodoCounts = { done: 0, total: 0, inProgress: 0, pending: 0, abandoned: 0 };
  for (const phase of phases) {
    for (const item of phase.tasks) {
      counts.total += 1;
      if (item.status === "completed") counts.done += 1;
      else if (item.status === "in_progress") counts.inProgress += 1;
      else if (item.status === "pending") counts.pending += 1;
      else counts.abandoned += 1;
    }
  }
  return counts;
}

/** The item in progress, else the first pending one, for the collapsed dock header. */
export function currentTodo(phases: readonly TodoPhase[]): string | null {
  const items = phases.flatMap((phase) => phase.tasks);
  return (items.find((item) => item.status === "in_progress") ?? items.find((item) => item.status === "pending"))?.content ?? null;
}

export function todoDot(status: TodoStatus, live: boolean): StateDotState {
  switch (status) {
    case "completed":
      return "done";
    case "in_progress":
      return live ? "ongoing" : "idle";
    case "pending":
    case "abandoned":
      return "idle";
  }
}

export function goalVisible(goal: WireGoal | null | undefined): goal is WireGoal {
  return goal !== null && goal !== undefined;
}
