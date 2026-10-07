import type { DagRun } from "../../../shared/protocol";

export interface WorkflowTransition {
  readonly runId: string;
  readonly nodeId: string;
  readonly label: string;
  readonly state: string;
  readonly atMs: number;
}

/** First sightings are baselines, not historical transitions. Keys include the run to isolate reused node IDs. */
export function observeWorkflow(runs: readonly DagRun[], previous: ReadonlyMap<string, string>, atMs: number): {
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
  return { states, transitions };
}
