import { expect, it } from "vitest";
import type { DagRun, LiveTask } from "../../shared/protocol";
import { observeWorkflow } from "../../src/ui/conversation/workflow-activity";

it("observes ordinary task changes without inventing first-sighting events", () => {
  const task: LiveTask = { task_id: "task-1", status: "running", execution_mode: "in-process", model: "test/model", residency_state: "active", depth: 1, created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z", task_summary: "Inspect app" };
  const baseline = observeWorkflow([], new Map(), 1, [task]);
  expect(baseline.transitions).toEqual([]);
  expect(observeWorkflow([], baseline.states, 2, [{ ...task, status: "completed" }]).transitions).toEqual([
    { runId: "task", nodeId: "task-1", label: "Inspect app", state: "completed", atMs: 2 },
  ]);
});

function run(id: string, state: string): DagRun {
  return { run_id: id, run_key: id, name: id, status: "running", created_at: "", updated_at: "", counts: {}, edges: [], waves: [],
    nodes: [{ id: "node", label: "Work", prompt: "", state, depends_on: [], attempt: 1, created_at: "" }] };
}

it("records changes but not the initial snapshot or identical repeats", () => {
  const initial = observeWorkflow([run("a", "running")], new Map(), 100);
  expect(initial.transitions).toEqual([]);
  const changed = observeWorkflow([run("a", "completed")], initial.states, 200);
  expect(changed.transitions).toEqual([{ runId: "a", nodeId: "node", label: "Work", state: "completed", atMs: 200 }]);
  expect(observeWorkflow([run("a", "completed")], changed.states, 300).transitions).toEqual([]);
});

it("does not confuse the same node ID in a new run or a removed snapshot", () => {
  const initial = observeWorkflow([run("a", "running")], new Map(), 100);
  expect(observeWorkflow([run("b", "completed")], initial.states, 200).transitions).toEqual([]);
  const empty = observeWorkflow([], initial.states, 200);
  expect(observeWorkflow([run("a", "completed")], empty.states, 300).transitions).toEqual([]);
});
