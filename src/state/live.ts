import type { AppState, ThreadLiveState } from "./types";
import { updateConversation } from "./conversation";
import { parseLiveExtension } from "./live-wire";

export function emptyLiveState(): ThreadLiveState {
  return {
    freshness: "unattached", runs: {}, runOrder: [], tasks: {}, taskOrder: [], historicalTasks: [], taskWork: [],
    dagActivity: {}, heartbeat: null, goal: undefined, todo: null, diagnostics: 0,
    generation: 0, goalRevision: 0, todoRevision: 0,
  };
}

/** Extension snapshots are wholesale replacements, including optional fields and empty rosters. */
export function applyLiveExtension(state: AppState, threadId: string, name: string, data: unknown): AppState {
  const parsed = parseLiveExtension(name, data);
  if (parsed === null) {
    return updateConversation(state, threadId, (conversation) => ({
      ...conversation, live: { ...conversation.live, diagnostics: Math.min(1000, conversation.live.diagnostics + 1) },
    }));
  }
  if ((parsed.name === "omo.dag.updated" || parsed.name === "omo.task.updated") && parsed.data.parent_session_id !== threadId) return state;
  const linked = parsed.name === "omo.task.updated" ? { ...state, threadLinks: [
    ...state.threadLinks.filter(link => link.parentId !== threadId || link.taskId === undefined),
    ...parsed.data.tasks.map(task => ({ parentId: threadId, ...(task.child_session_id ? { childId: task.child_session_id } : {}), taskId: task.task_id, title: task.task_summary ?? task.name ?? task.description ?? task.task_id, status: task.status })),
  ] } : state;
  return updateConversation(linked, threadId, (conversation) => {
    const live = conversation.live;
    switch (parsed.name) {
      case "omo.dag.updated": {
        const { truncatedRuns: _previous, ...rest } = live;
        const runs = Object.fromEntries(parsed.data.runs.map((run) => [run.run_id, run]));
        const dagActivity = Object.fromEntries(Object.entries(live.dagActivity).filter(([id]) => runs[id] !== undefined).map(([id, entries]) => [
          id, Object.fromEntries(Object.entries(entries).filter(([nodeId]) => runs[id]?.nodes.some((node) => node.id === nodeId))),
        ]));
        return { ...conversation, live: { ...rest, freshness: "live", runs, runOrder: parsed.data.runs.map((run) => run.run_id), dagActivity,
          ...(parsed.data.truncated_runs === undefined ? {} : { truncatedRuns: parsed.data.truncated_runs }) } };
      }
      case "omo.task.updated": {
        const { truncatedTasks: _previous, ...rest } = live;
        return { ...conversation, live: { ...rest, freshness: "live",
          tasks: Object.fromEntries(parsed.data.tasks.map((task) => [task.task_id, task])), taskOrder: parsed.data.tasks.map((task) => task.task_id),
          ...(parsed.data.truncated_tasks === undefined ? {} : { truncatedTasks: parsed.data.truncated_tasks }) } };
      }
      case "omo.dag.activity": {
        const activity = parsed.data;
        return { ...conversation, live: { ...live, dagActivity: { ...live.dagActivity,
          [activity.runId]: { ...live.dagActivity[activity.runId], [activity.nodeId]: activity } } } };
      }
      case "omo.dag.heartbeat":
        return { ...conversation, live: { ...live, heartbeat: parsed.data } };
    }
  });
}
