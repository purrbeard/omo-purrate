import { describe, expect, it } from "vitest";
import type { TaskWork } from "../../shared/ipc";
import type { DagNode, DagRun, LiveTask } from "../../shared/protocol";
import { groupNodesByDependency, nodeElapsedMs, taskForest, workSummary } from "../../src/ui/conversation/activity-model";
import { parseDagUpdated, parseTasksUpdated } from "../../src/state/live-wire";
import { createInitialState, reduce } from "../../src/state";

const AT = "2026-10-05T00:00:00.000Z";
function task(id: string, child?: string): LiveTask {
  return { task_id: id, status: "running", model: "provider/model", execution_mode: "in-process", residency_state: "resident",
    depth: 1, created_at: AT, updated_at: AT, ...(child === undefined ? {} : { child_session_id: child }) };
}
function work(id: string, parent: string, child?: string): TaskWork {
  return { parentSessionId: parent, task: task(id, child), todo: null, activity: null };
}
const node: DagNode = { id: "A", prompt: "Build", state: "running", depends_on: [], attempt: 1, created_at: AT, task_id: "owner", started_at: AT };
const run: DagRun = { run_id: "r", run_key: "k", name: "Build", status: "running", created_at: AT, updated_at: AT,
  counts: {}, nodes: [node], waves: [{ index: 0, node_ids: ["A"] }], edges: [] };

describe("compact work derivation", () => {
  it("orders all nodes by dependencies even with missing or obsolete scheduler waves", () => {
    const graph = { ...run, nodes: [
      { ...node, id: "C", depends_on: ["A", "B"] }, { ...node, id: "B", depends_on: ["A"] }, node,
    ], waves: [] };
    expect(groupNodesByDependency(graph).map((group) => group.nodes.map((item) => item.id))).toEqual([["A"], ["B"], ["C"]]);
    expect(groupNodesByDependency({ ...graph, edges: [{ from: "C", to: "A" }] })[0]?.index).toBeNull();
  });
  it("counts DAG-linked tasks once and retains completed and failed counts while stale", () => {
    const tasks = [task("owner"), { ...task("extra"), status: "error" }];
    expect(workSummary([run], tasks, true)).toEqual({ done: 0, total: 2, running: 1, failed: 1 });
    expect(workSummary([{ ...run, nodes: [{ ...node, state: "completed" }] }], tasks, false))
      .toEqual({ done: 1, total: 2, running: 0, failed: 1 });
  });
  it("joins nested work by explicit session links, excluding unrelated work and retaining live root fields", () => {
    const owner = task("owner", "child-session");
    const forest = taskForest([owner], [
      work("owner", "root", "child-session"), work("child", "child-session", "grand-session"),
      work("grand", "grand-session"), work("foreign", "elsewhere"),
    ]);
    expect(forest[0]?.task).toBe(owner);
    expect(forest[0]?.children[0]?.task.task_id).toBe("child");
    expect(forest[0]?.children[0]?.children[0]?.task.task_id).toBe("grand");
    expect(forest).toHaveLength(1);
  });
  it("does not count detached or restored task records as executing while the parent is live", () => {
    const suspended = { ...task("owner"), residency_state: "persisted_only" };
    const detached = { ...task("detached"), residency_state: "rpc_detached" };
    const restored = { task_id: "history", status: "running", created_at: AT, source: "history" as const };
    expect(workSummary([run], [suspended, detached, restored, task("resident")], true).running).toBe(1);
    expect(workSummary([{ ...run, status: "completed" }], [], true).running).toBe(0);
  });
  it("does not duplicate child work or loop through cyclic session links", () => {
    const forest = taskForest([task("owner", "s1"), task("child", "s2")], [
      work("owner", "s2", "s1"), work("child", "s1", "s2"),
    ]);
    expect(forest).toHaveLength(1);
    expect(forest[0]?.children).toHaveLength(1);
    expect(forest[0]?.children[0]?.children).toEqual([]);
  });
  it("measures node execution endpoints without ticking stale or never-started nodes", () => {
    const now = Date.parse(AT) + 12000;
    expect(nodeElapsedMs(node, now, true)).toBe(12000);
    expect(nodeElapsedMs(node, now, false)).toBeNull();
    expect(nodeElapsedMs({ ...node, state: "completed", completed_at: "2026-10-05T00:00:05.000Z" }, now, false)).toBe(5000);
    expect(nodeElapsedMs({ ...node, started_at: "invalid" }, now, true)).toBeNull();
  });
});

describe("wire child links and refresh fencing", () => {
  it("validates consumed child ids, timestamps and tool activity", () => {
    const data = { parent_session_id: "root", tasks: [{ ...task("owner", "child"),
      live_progress: { activity: "tool", started_at: 1000, current_tool: "bash", last_assistant_line: "Run tests", turns: 4 } }] };
    expect(parseTasksUpdated(data)?.tasks[0]?.child_session_id).toBe("child");
    expect(parseTasksUpdated({ ...data, tasks: [{ ...data.tasks[0], child_session_id: 1 }] })).toBeNull();
    expect(parseTasksUpdated({ ...data, tasks: [{ ...task("owner"), live_progress: { activity: "tool", started_at: Infinity, turns: 1 } }] })).toBeNull();
    expect(parseDagUpdated({ parent_session_id: "root", runs: [{ ...run, nodes: [{ ...node, depends_on: [1] }] }] })).toBeNull();
  });
  it("keeps child-work reads isolated by thread and rejects a previous connection generation", () => {
    let state = reduce(createInitialState(), { type: "thread/activated", threadId: "root" });
    state = reduce(state, { type: "taskWork/loaded", threadId: "root", work: [work("owner", "root")], generation: 0 });
    expect(state.conversations["root"]?.live.taskWork).toHaveLength(1);
    const before = state;
    expect(reduce(state, { type: "taskWork/loaded", threadId: "root", work: [], generation: 9 })).toEqual(before);
    expect(reduce(state, { type: "taskWork/loaded", threadId: "other", work: [], generation: 0 })).toEqual(before);
  });
});
