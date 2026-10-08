import { describe, expect, it } from "vitest";
import type { HistoricalTask } from "../../shared/ipc";
import type { DagActivity, DagNode, DagRun, LiveTask, TodoPhase } from "../../shared/protocol";
import {
  activitySummary,
  currentTodo,
  excerpt,
  goalVisible,
  groupNodesByWave,
  isSuspended,
  knownNodeState,
  nodeActivityLine,
  nodeDot,
  orderTasks,
  runDot,
  runStateCounts,
  runTotal,
  taskCounters,
  taskDot,
  taskElapsedMs,
  taskExcerpt,
  taskRoute,
  taskTitle,
  todoCounts,
  todoDot,
} from "../../src/ui/conversation/activity-model";

const AT = "2026-10-01T00:00:00.000Z";

function node(id: string, state: string, extra: Partial<DagNode> = {}): DagNode {
  return { id, prompt: `Do ${id}`, depends_on: [], state, attempt: 1, created_at: AT, ...extra };
}

function run(extra: Partial<DagRun> = {}): DagRun {
  return {
    run_id: "r1", run_key: "k", name: "mass-ulw", status: "running", created_at: AT, updated_at: AT,
    counts: {}, nodes: [], edges: [], waves: [], ...extra,
  };
}

function liveTask(extra: Partial<LiveTask> = {}): LiveTask {
  return {
    task_id: "t1", status: "running", execution_mode: "in-process", model: "fake/alpha", residency_state: "resident",
    depth: 1, created_at: AT, updated_at: AT, ...extra,
  };
}

function historical(extra: Partial<HistoricalTask> = {}): HistoricalTask {
  return { task_id: "h1", status: "running", source: "history", ...extra };
}

describe("node, run and task dots", () => {
  it("keeps the eight node states distinct by name and animates only live running work", () => {
    for (const state of ["pending", "blocked", "scheduled", "running", "completed", "failed", "cancelled", "skipped"]) {
      expect(knownNodeState(state)).toBe(state);
    }
    expect(knownNodeState("amending")).toBeNull();
    expect(nodeDot("running", true)).toBe("ongoing");
    expect(nodeDot("running", false)).toBe("idle");
    expect(nodeDot("failed", true)).toBe("error");
    expect(nodeDot("completed", false)).toBe("done");
    expect(nodeDot("amending", true)).toBe("idle");
  });

  it("maps run and task statuses without animating stale state", () => {
    expect(runDot("running", true)).toBe("ongoing");
    expect(runDot("running", false)).toBe("idle");
    expect(runDot("paused", true)).toBe("warning");
    expect(taskDot("running", false)).toBe("idle");
    expect(taskDot("lost", true)).toBe("error");
    expect(taskDot("interrupted", true)).toBe("warning");
  });
});

describe("groupNodesByWave", () => {
  it("orders waves by index, lists each node once and appends nodes without a wave", () => {
    const groups = groupNodesByWave(run({
      nodes: [node("C", "blocked"), node("A", "running"), node("B", "blocked"), node("D", "pending")],
      waves: [{ index: 1, node_ids: ["B", "C", "A"] }, { index: 0, node_ids: ["A", "missing"] }],
    }));
    expect(groups.map((group) => [group.index, group.nodes.map((entry) => entry.id)])).toEqual([
      [0, ["A"]], [1, ["B", "C"]], [null, ["D"]],
    ]);
  });

  it("returns no groups for an empty run", () => {
    expect(groupNodesByWave(run())).toEqual([]);
  });
});

describe("runStateCounts", () => {
  it("drops total and zero counts and orders known states before unknown ones", () => {
    const counts = runStateCounts(run({ counts: { total: 6, failed: 1, running: 2, zeta: 1, blocked: 2, pending: 0 } }));
    expect(counts).toEqual([
      { state: "blocked", count: 2 }, { state: "running", count: 2 }, { state: "failed", count: 1 }, { state: "zeta", count: 1 },
    ]);
  });

  it("derives counts from nodes when the snapshot carries none", () => {
    const counts = runStateCounts(run({ nodes: [node("A", "running"), node("B", "blocked"), node("C", "blocked")] }));
    expect(counts).toEqual([{ state: "blocked", count: 2 }, { state: "running", count: 1 }]);
    expect(runTotal(run({ nodes: [node("A", "running")] }))).toBe(1);
    expect(runTotal(run({ counts: { total: 5 } }))).toBe(5);
  });
});

describe("activitySummary", () => {
  it("counts running runs and tasks only while live", () => {
    const runs = [run(), run({ run_id: "r2", status: "completed" })];
    const tasks = [liveTask(), liveTask({ task_id: "t2", status: "completed" })];
    expect(activitySummary(runs, tasks, true)).toEqual({ running: 2, total: 4 });
    expect(activitySummary(runs, tasks, false)).toEqual({ running: 0, total: 4 });
    expect(activitySummary([], [historical(), liveTask()], true)).toEqual({ running: 1, total: 2 });
  });
});

describe("task rows", () => {
  it("titles by summary, then name, then description, then id", () => {
    expect(taskTitle(liveTask({ task_summary: " Fix it ", name: "n" }))).toBe("Fix it");
    expect(taskTitle(liveTask({ name: "lane", description: "d" }))).toBe("lane");
    expect(taskTitle(liveTask({ description: "describe" }))).toBe("describe");
    expect(taskTitle(historical())).toBe("h1");
  });

  it("routes by category or agent and model", () => {
    expect(taskRoute(liveTask({ category: "quick", agent_type: "explore" }))).toEqual(["quick", "fake/alpha"]);
    expect(taskRoute(historical({ agent_type: "explore" }))).toEqual(["explore"]);
  });

  it("labels rpc_detached and persisted_only tasks suspended", () => {
    expect(isSuspended(liveTask({ residency_state: "rpc_detached" }))).toBe(true);
    expect(isSuspended(liveTask({ residency_state: "persisted_only" }))).toBe(true);
    expect(isSuspended(liveTask({ residency_state: "resident" }))).toBe(false);
    expect(isSuspended(historical())).toBe(false);
  });

  it("measures live elapsed time from progress and falls back to the recorded runtime", () => {
    const progress = { activity: "working", started_at: 1_000, turns: 2, tool_calls: 5 };
    expect(taskElapsedMs(liveTask({ live_progress: progress }), 4_500)).toBe(3_500);
    expect(taskElapsedMs(liveTask({ status: "completed", run_stats: { runtime_ms: 42, turns: 1, tool_calls: 0 } }), 9_999)).toBe(42);
    expect(taskElapsedMs(liveTask(), 1)).toBeNull();
    expect(taskElapsedMs(historical(), 1)).toBeNull();
    expect(taskCounters(liveTask({ live_progress: progress, run_stats: { runtime_ms: 1, turns: 9, tool_calls: 9 } }))).toEqual({ turns: 2, toolCalls: 5 });
    expect(taskCounters(liveTask({ run_stats: { runtime_ms: 1, turns: 3, tool_calls: 4 } }))).toEqual({ turns: 3, toolCalls: 4 });
    expect(taskCounters(historical())).toEqual({ turns: null, toolCalls: null });
  });

  it("keeps suspended and disconnected progress on recorded runtime while resident work advances", () => {
    const live_progress = { activity: "working", started_at: 1_000, turns: 2, tool_calls: 5 };
    const run_stats = { runtime_ms: 2_000, turns: 2, tool_calls: 5 };
    for (const residency_state of ["rpc_detached", "persisted_only"] as const) {
      const suspended = liveTask({ residency_state, live_progress, run_stats });
      expect(taskElapsedMs(suspended, 4_500)).toBe(2_000);
      expect(taskElapsedMs(suspended, 90_000)).toBe(2_000);
      expect(taskElapsedMs(liveTask({ residency_state, live_progress }), 90_000)).toBeNull();
    }
    const resident = liveTask({ live_progress, run_stats });
    expect(taskElapsedMs(resident, 4_500, false)).toBe(2_000);
    expect(taskElapsedMs(resident, 90_000, false)).toBe(2_000);
    expect(taskElapsedMs(resident, 4_500)).toBe(3_500);
    expect(taskElapsedMs(resident, 5_500)).toBe(4_500);
  });

  it("prefers the error excerpt and flattens and truncates long text", () => {
    expect(taskExcerpt(liveTask({ final_response: "done", error_message: "402: Insufficient Balance" }))).toEqual({ kind: "error", text: "402: Insufficient Balance" });
    expect(taskExcerpt(historical({ final_response: "line one\n\nline two" }))).toEqual({ kind: "result", text: "line one line two" });
    expect(taskExcerpt(liveTask({ final_response: "  " }))).toBeNull();
    const long = excerpt("x".repeat(500), 10);
    expect(long).toHaveLength(10);
    expect(long.endsWith("…")).toBe(true);
  });

  it("orders running, then pending, then settled tasks, stable within a group", () => {
    const ordered = orderTasks([
      liveTask({ task_id: "done1", status: "completed" }), liveTask({ task_id: "pend", status: "pending" }),
      liveTask({ task_id: "run1" }), liveTask({ task_id: "done2", status: "error" }), liveTask({ task_id: "run2" }),
    ]);
    expect(ordered.map((task) => task.task_id)).toEqual(["run1", "run2", "pend", "done1", "done2"]);
  });

  it("keeps restored tasks after every live task in their own order", () => {
    const ordered = orderTasks([
      historical({ task_id: "old-run" }), liveTask({ task_id: "done", status: "completed" }),
      historical({ task_id: "old-done", status: "completed" }), liveTask({ task_id: "run" }),
    ]);
    expect(ordered.map((task) => task.task_id)).toEqual(["run", "done", "old-run", "old-done"]);
  });

  it("joins node activity from DAG telemetry, else the attached task, only for running nodes", () => {
    const activity: DagActivity = { schemaVersion: 1, runId: "r1", nodeId: "B", taskId: "t1", at: AT, activity: "implementing", currentTool: "edit", turns: 2 };
    const task = liveTask({ live_progress: { activity: "reading", started_at: 0, current_tool: "read", turns: 1 } });
    expect(nodeActivityLine(node("B", "running"), activity, task)).toBe("implementing · edit");
    expect(nodeActivityLine(node("B", "running"), null, task)).toBe("reading · read");
    expect(nodeActivityLine(node("B", "completed"), activity, task)).toBeNull();
    expect(nodeActivityLine(node("B", "running"), null, undefined)).toBeNull();
  });
});

describe("todo and goal", () => {
  const phases: TodoPhase[] = [
    { name: "Build", tasks: [{ content: "A", status: "completed" }, { content: "B", status: "pending" }] },
    { name: "Verify", tasks: [{ content: "C", status: "abandoned" }, { content: "D", status: "in_progress" }] },
  ];

  it("counts every status and picks the item in progress before the first pending one", () => {
    expect(todoCounts(phases)).toEqual({ done: 1, total: 4, inProgress: 1, pending: 1, abandoned: 1 });
    expect(currentTodo(phases)).toBe("D");
    expect(currentTodo([{ name: "x", tasks: [{ content: "E", status: "completed" }, { content: "F", status: "pending" }] }])).toBe("F");
    expect(currentTodo([])).toBeNull();
  });

  it("animates an in-progress item only when live", () => {
    expect(todoDot("in_progress", true)).toBe("ongoing");
    expect(todoDot("in_progress", false)).toBe("idle");
    expect(todoDot("completed", false)).toBe("done");
  });

  it("hides a null or unknown goal", () => {
    expect(goalVisible(null)).toBe(false);
    expect(goalVisible(undefined)).toBe(false);
    expect(goalVisible({ threadId: "t", objective: "o", status: "complete", tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0 })).toBe(true);
  });
});
