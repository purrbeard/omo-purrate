import type { DagRun } from "../../../shared/protocol";
import { isHistoricalTask, taskTitle, type ActivityTask } from "./activity-model";

export interface WorkflowTransition {
  readonly runId: string;
  readonly nodeId: string;
  readonly label: string;
  readonly state: string;
  readonly atMs: number;
}

/** First sightings are baselines, not historical transitions. Keys include the run to isolate reused node IDs. */
export function observeWorkflow(runs: readonly DagRun[], previous: ReadonlyMap<string, string>, atMs: number, tasks: readonly ActivityTask[] = []): {
  states: Map<string, string>; transitions: WorkflowTransition[];
} {
  const states = new Map<string, string>();
  const transitions: WorkflowTransition[] = [];
  for (const run of runs) {
    for (const node of run.nodes) {
      const key = `${run.run_id}\u0000${node.id}`;
      states.set(key, node.state);
      const before = previous.get(key);
      if (before !== undefined && before !== node.state) {
        transitions.push({ runId: run.run_id, nodeId: node.id, label: node.label?.trim() || node.id, state: node.state, atMs });
      }
    }
  }
  const linked = new Set(runs.flatMap(run => run.nodes.map(node => node.task_id)));
  for (const task of tasks) {
    if (linked.has(task.task_id) || isHistoricalTask(task)) continue;
    const key = `task\u0000${task.task_id}`;
    states.set(key, task.status);
    const before = previous.get(key);
    if (before !== undefined && before !== task.status) transitions.push({ runId: "task", nodeId: task.task_id, label: taskTitle(task), state: task.status, atMs });
  }
  return { states, transitions };
}
