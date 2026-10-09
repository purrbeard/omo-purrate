import { describe, expect, it } from "vitest";
import type { DagRun, LiveTask, WireGoal } from "../../shared/protocol";
import { createAppStore, createInitialState, reduce, selectDagRuns, selectTasks, selectGoal, selectTodo } from "../../src/state";
import { parseDagActivity, parseDagHeartbeat, parseDagUpdated, parseGoal, parseLiveExtension, parseTasksUpdated, parseTodo } from "../../src/state/live-wire";
import { parseNotification } from "../../src/state/wire";
import { makeThread } from "./helpers";
import { OMO_INSTALL_COMMAND } from "../../shared/ipc";

const run: DagRun = {
  run_id: "r", run_key: "key", name: "run", status: "running", created_at: "now", updated_at: "now",
  counts: { running: 1 }, nodes: [{ id: "A", prompt: "do A", depends_on: [], state: "running", attempt: 1, created_at: "now" }],
  edges: [], waves: [{ index: 0, node_ids: ["A"] }],
};
const task: LiveTask = {
  task_id: "t", status: "running", execution_mode: "in-process", model: "model", residency_state: "resident",
  depth: 1, created_at: "now", updated_at: "now",
};
const goal: WireGoal = {
  threadId: "T", objective: "ship", status: "active", tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 1, createdAt: 1, updatedAt: 2,
};
const activity = { schemaVersion: 1, runId: "r", nodeId: "A", taskId: "t", at: "now", activity: "working", turns: 1 };
function extension(state: ReturnType<typeof createInitialState>, name: string, data: unknown, threadId = "T", receivedAtMs = 1) {
  return reduce(state, { type: "rpc/notification", notification: { method: "extension_event", params: { threadId, name, data } }, receivedAtMs });
}
function opened() {
  return reduce(createInitialState(), { type: "thread/activated", threadId: "T" });
}

describe("live wire parsing", () => {
  it("validates full DAG records while retaining unfamiliar statuses", () => {
    expect(parseDagUpdated({ parent_session_id: "T", runs: [{ ...run, status: "future" }], truncated_runs: 3 })?.runs[0]?.status).toBe("future");
    expect(parseDagUpdated({ parent_session_id: "T", runs: [{ ...run, waves: [{ index: 0, node_ids: [1] }] }] })).toBeNull();
    expect(parseDagUpdated({ parent_session_id: "T", runs: [{ ...run, nodes: [{ ...run.nodes[0], last_error: { code: 1, message: "bad" } }] }] })).toBeNull();
  });
  it("validates progress stats and preserves unknown failure values", () => {
    const data = { parent_session_id: "T", tasks: [{ ...task, failure_kind: { future: true }, failure_reason: 7,
      live_progress: { activity: "working", started_at: 1, turns: 2, total_tokens: 3 },
      run_stats: { runtime_ms: 1, turns: 2, tool_calls: 3, cost_status: "unavailable" } }] };
    expect(parseTasksUpdated(data)?.tasks[0]).toEqual(data.tasks[0]);
    expect(parseTasksUpdated({ ...data, tasks: [{ ...task, live_progress: { activity: "bad" } }] })).toBeNull();
    expect(parseTasksUpdated({ ...data, tasks: [{ ...task, run_stats: { runtime_ms: "x" } }] })).toBeNull();
    expect(parseTasksUpdated({ ...data, tasks: [{ ...task, final_response_truncated: false }] })).toBeNull();
  });
  it("validates activity heartbeat goal and todo", () => {
    expect(parseDagActivity(activity)).toEqual(activity);
    expect(parseDagActivity({ ...activity, turns: "1" })).toBeNull();
    expect(parseDagHeartbeat({ schemaVersion: 1, at: "now", runs: [{ runId: "r", headSeq: 1 }] })?.runs).toHaveLength(1);
    expect(parseDagHeartbeat({ schemaVersion: 2, at: "now", runs: [] })).toBeNull();
    expect(parseGoal(goal)).toEqual(goal);
    expect(parseGoal({ ...goal, status: "unknown" })).toBeNull();
    expect(parseTodo({ schema: "v2", phases: [{ name: "phase", tasks: [{ content: "item", status: "cancelled" }] }] })?.phases[0]?.tasks[0]?.status).toBe("abandoned");
    expect(parseTodo({ schema: "v2", phases: [{ name: "phase", tasks: [{ content: "item", status: "invalid" }] }] })).toBeNull();
  });
  it("routes known names and rejects unknown or invalid payloads without throwing", () => {
    for (const [name, data] of [["omo.dag.updated", { parent_session_id: "T", runs: [] }], ["omo.task.updated", { parent_session_id: "T", tasks: [] }],
      ["omo.dag.activity", activity], ["omo.dag.heartbeat", { schemaVersion: 1, at: "now", runs: [] }]] as const) {
      expect(parseLiveExtension(name, data)?.name).toBe(name);
      expect(parseLiveExtension(name, {})).toBeNull();
    }
    expect(parseLiveExtension("future", {})).toBeNull();
    expect(parseNotification({ method: "extension_event", params: { threadId: "T", name: "future", data: 1 } })?.method).toBe("extension_event");
    expect(parseNotification({ method: "thread/goal/updated", params: { threadId: "other", turnId: null, goal } })).toBeNull();
  });
});

describe("thread live state", () => {
  it("observes transitions in inactive threads without mixing baselines or logs", () => {
    let state = extension(opened(), "omo.dag.updated", { parent_session_id: "T", runs: [run] });
    state = extension(state, "omo.task.updated", { parent_session_id: "child", tasks: [task] }, "child");
    expect(state.conversations["T"]?.live.activityLog).toEqual([]);
    expect(state.conversations["child"]?.live.activityLog).toEqual([]);
    state = extension(state, "omo.dag.updated", { parent_session_id: "T", runs: [{ ...run, nodes: [{ ...run.nodes[0], state: "completed" }] }] }, "T", 20);
    state = extension(state, "omo.task.updated", { parent_session_id: "child", tasks: [{ ...task, status: "completed" }] }, "child", 30);
    expect(state.conversations["T"]?.live.activityLog).toEqual([{ runId: "r", nodeId: "A", label: "A", state: "completed", atMs: 20 }]);
    expect(state.conversations["child"]?.live.activityLog).toEqual([{ runId: "task", nodeId: "t", label: "t", state: "completed", atMs: 30 }]);
  });
  it("retains observations after a panel subscriber unmounts and bounds each thread to 50 entries", () => {
    const store = createAppStore();
    const sendTask = (status: string, atMs: number) => store.dispatch({ type: "rpc/notification", receivedAtMs: atMs,
      notification: { method: "extension_event", params: { threadId: "T", name: "omo.task.updated", data: { parent_session_id: "T", tasks: [{ ...task, status }] } } } });
    const unmountPanel = store.subscribe(() => {});
    sendTask("running", 0);
    unmountPanel();
    for (let index = 1; index <= 60; index++) sendTask(index % 2 === 0 ? "running" : "completed", index);
    store.dispatch({ type: "thread/activated", threadId: "child" });
    const remountPanel = store.subscribe(() => {});
    store.dispatch({ type: "thread/activated", threadId: "T" });
    const entries = store.getState().conversations["T"]?.live.activityLog;
    expect(entries).toHaveLength(50);
    expect(entries?.[0]?.atMs).toBe(60);
    expect(entries?.[49]?.atMs).toBe(11);
    expect(store.getState().conversations["child"]?.live.activityLog).toEqual([]);
    remountPanel();
  });
  it("excludes DAG-owned task transitions and does not log activity-only updates", () => {
    let state = extension(opened(), "omo.dag.updated", { parent_session_id: "T", runs: [{ ...run, nodes: [{ ...run.nodes[0], task_id: "t" }] }] });
    state = extension(state, "omo.task.updated", { parent_session_id: "T", tasks: [task] });
    state = extension(state, "omo.task.updated", { parent_session_id: "T", tasks: [{ ...task, status: "completed" }] });
    state = extension(state, "omo.dag.activity", activity);
    expect(state.conversations["T"]?.live.activityLog).toEqual([]);
  });
  it("reconnect snapshots independently baseline DAGs and tasks while retaining captured entries", () => {
    let state = extension(opened(), "omo.dag.updated", { parent_session_id: "T", runs: [run] });
    state = extension(state, "omo.task.updated", { parent_session_id: "T", tasks: [task] });
    state = extension(state, "omo.task.updated", { parent_session_id: "T", tasks: [{ ...task, status: "completed" }] });
    const captured = state.conversations["T"]?.live.activityLog;
    state = reduce(state, { type: "bridge/status", status: { state: "restarting", omo: null, userAgent: null, message: null, stderrTail: null, exitCode: null, restartAttempt: 1, installCommand: OMO_INSTALL_COMMAND } });
    state = extension(state, "omo.dag.updated", { parent_session_id: "T", runs: [{ ...run, nodes: [{ ...run.nodes[0], state: "completed" }] }] });
    state = extension(state, "omo.task.updated", { parent_session_id: "T", tasks: [task] });
    expect(state.conversations["T"]?.live.activityLog).toBe(captured);
  });
  it("retains bind-time snapshots through thread opening and exposes stable selections", () => {
    let state = extension(createInitialState(), "omo.dag.updated", { parent_session_id: "T", runs: [run] });
    state = extension(state, "omo.task.updated", { parent_session_id: "T", tasks: [task] });
    state = reduce(state, { type: "thread/opened", thread: makeThread("T"), resumed: true });
    expect(selectDagRuns(state, "T")).toEqual([run]);
    expect(selectTasks(state, "T")).toEqual([task]);
    expect(state.threadLinks).toMatchObject([{ parentId: "T", taskId: task.task_id, status: task.status }]);
    expect(selectDagRuns(state, "T")).toBe(selectDagRuns(state, "T"));
    expect(selectTasks(state, "T")).toBe(selectTasks(state, "T"));
    expect(selectDagRuns(state, "absent")).toBe(selectDagRuns(state, "absent"));
    expect(selectTasks(state, "absent")).toBe(selectTasks(state, "absent"));
  });
  it("replaces DAG records optional fields and truncation rather than merging", () => {
    let state = extension(opened(), "omo.dag.updated", { parent_session_id: "T", runs: [{ ...run, completed_at: "then", lease_holder_pid: 9,
      nodes: [{ ...run.nodes[0], last_error: { code: "error", message: "oops" } }] }, { ...run, run_id: "omit" }], truncated_runs: 4 });
    state = extension(state, "omo.dag.updated", { parent_session_id: "T", runs: [run] });
    expect(selectDagRuns(state, "T")).toEqual([run]);
    expect(state.conversations["T"]?.live.truncatedRuns).toBeUndefined();
    state = extension(state, "omo.dag.updated", { parent_session_id: "T", runs: [] });
    expect(selectDagRuns(state, "T")).toEqual([]);
  });
  it("replaces optional task progress and removes omitted records including empty roster", () => {
    let state = extension(opened(), "omo.task.updated", { parent_session_id: "T", tasks: [{ ...task, final_response: "old", live_progress: { activity: "old", started_at: 1, turns: 1 } }, { ...task, task_id: "omit" }], truncated_tasks: 2 });
    state = extension(state, "omo.task.updated", { parent_session_id: "T", tasks: [task] });
    expect(selectTasks(state, "T")).toEqual([task]);
    expect(state.conversations["T"]?.live.truncatedTasks).toBeUndefined();
    state = extension(state, "omo.task.updated", { parent_session_id: "T", tasks: [] });
    expect(selectTasks(state, "T")).toEqual([]);
  });
  it("routes only the envelope thread and ignores mismatched parent", () => {
    const state = extension(opened(), "omo.dag.updated", { parent_session_id: "other", runs: [run] });
    expect(state).toEqual(opened());
    const routed = extension(state, "omo.dag.updated", { parent_session_id: "other", runs: [run] }, "other");
    expect(selectDagRuns(routed, "T")).toEqual([]);
    expect(selectDagRuns(routed, "other")).toEqual([run]);
  });
  it("keeps latest activity separate from durable nodes and heartbeat liveness", () => {
    let state = extension(opened(), "omo.dag.updated", { parent_session_id: "T", runs: [run] });
    state = extension(state, "omo.dag.activity", activity);
    state = extension(state, "omo.dag.activity", { ...activity, activity: "latest", currentTool: "edit" });
    state = extension(state, "omo.dag.heartbeat", { schemaVersion: 1, at: "then", runs: [{ runId: "r", headSeq: 4 }] });
    expect(state.conversations["T"]?.live.dagActivity["r"]?.["A"]?.activity).toBe("latest");
    expect(selectDagRuns(state, "T")).toEqual([run]);
    state = extension(state, "omo.dag.updated", { parent_session_id: "T", runs: [] });
    expect(state.conversations["T"]?.live.dagActivity).toEqual({});
  });
  it("bounds diagnostic counters without altering valid snapshot records", () => {
    let state = extension(opened(), "omo.dag.updated", { parent_session_id: "T", runs: [run] });
    for (let index = 0; index < 1002; index++) state = extension(state, "unknown", {});
    expect(state.conversations["T"]?.live.diagnostics).toBe(1000);
    expect(selectDagRuns(state, "T")).toEqual([run]);
  });
  it("marks live state stale and fences reads after reconnect", () => {
    let state = extension(opened(), "omo.task.updated", { parent_session_id: "T", tasks: [task] });
    state = reduce(state, { type: "bridge/status", status: { state: "restarting", omo: null, userAgent: null, message: null, stderrTail: null, exitCode: null, restartAttempt: 1, installCommand: OMO_INSTALL_COMMAND } });
    expect(state.conversations["T"]?.live.freshness).toBe("stale");
    const before = state;
    state = reduce(state, { type: "goal/loaded", threadId: "T", goal, generation: 0, revision: 0 });
    expect(state).toEqual(before);
  });
  it("applies native goal get updated and clear while rejecting stale reads", () => {
    let state = reduce(opened(), { type: "goal/loaded", threadId: "T", goal, generation: 0, revision: 0 });
    expect(selectGoal(state, "T")).toEqual(goal);
    state = reduce(state, { type: "rpc/notification", notification: { method: "thread/goal/updated", params: { threadId: "T", turnId: null, goal: { ...goal, status: "paused" } } }, receivedAtMs: 1 });
    expect(selectGoal(state, "T")?.status).toBe("paused");
    state = reduce(state, { type: "rpc/notification", notification: { method: "thread/goal/cleared", params: { threadId: "T" } }, receivedAtMs: 1 });
    state = reduce(state, { type: "goal/loaded", threadId: "T", goal, generation: 0, revision: 0 });
    expect(selectGoal(state, "T")).toBeNull();
  });
  it("keeps history unattached and separate until a live roster wins", () => {
    let state = reduce(opened(), { type: "history/loaded", threadId: "T", turns: [], todo: { phases: [] },
      tasks: [{ task_id: "old", status: "running", source: "history" }] });
    expect(selectTasks(state, "T")[0]).toMatchObject({ source: "history" });
    expect(selectTodo(state, "T")?.source).toBe("history");
    expect(state.conversations["T"]?.live.freshness).toBe("unattached");
    expect(selectDagRuns(state, "T")).toEqual([]);
    state = reduce(state, { type: "thread/opened", thread: makeThread("T"), resumed: true });
    state = extension(state, "omo.task.updated", { parent_session_id: "T", tasks: [] });
    expect(selectTasks(state, "T")).toEqual([{ task_id: "old", status: "running", source: "history" }]);
    state = extension(state, "omo.task.updated", { parent_session_id: "T", tasks: [task, { ...task, task_id: "old", status: "completed" }] });
    expect(selectTasks(state, "T").map((entry) => [entry.task_id, entry.status, "source" in entry])).toEqual([
      ["t", "running", false], ["old", "completed", false],
    ]);
    state = reduce(state, { type: "todo/loaded", threadId: "T", todo: { phases: [] }, generation: 0, revision: 0 });
    expect(selectTodo(state, "T")?.source).toBe("live");
    state = reduce(state, { type: "todo/loaded", threadId: "T", todo: null, generation: 0, revision: 0 });
    expect(selectTodo(state, "T")?.source).toBe("live");
  });
});
