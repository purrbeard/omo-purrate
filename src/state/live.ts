import type { AppState, ThreadLiveState } from "./types";
import { updateConversation } from "./conversation";
import { parseLiveExtension } from "./live-wire";
import { observeWorkflow } from "../ui/conversation/workflow-activity";

export function emptyLiveState(): ThreadLiveState {
  return {
    freshness: "unattached", runs: {}, runOrder: [], tasks: {}, taskOrder: [], historicalTasks: [], taskWork: [],
    dagActivity: {}, heartbeat: null, goal: undefined, todo: null, diagnostics: 0,
    runsSource: null, dagRevision: 0, activityLog: [], activityBaseline: new Map(),
    generation: 0, goalRevision: 0, todoRevision: 0,
  };
}

/** Extension snapshots are wholesale replacements, including optional fields and empty rosters. */
export function applyLiveExtension(state: AppState, threadId: string, name: string, data: unknown, receivedAtMs: number): AppState {
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
    const observed = (next: ThreadLiveState): typeof conversation => {
      const linkedTasks = new Set(next.runOrder.flatMap(id => next.runs[id]?.nodes.flatMap(node => node.task_id === undefined ? [] : [node.task_id]) ?? []));
      const observation = observeWorkflow(next.runsSource === "live" ? next.runOrder.flatMap(id => next.runs[id] === undefined ? [] : [next.runs[id]]) : [],
        live.activityBaseline, receivedAtMs, next.taskOrder.flatMap(id => next.tasks[id] === undefined || linkedTasks.has(id) ? [] : [next.tasks[id]]));
      // A different roster cannot reattach stale records before their own reconnect snapshot arrives.
      for (const key of observation.states.keys()) {
        if (!live.activityBaseline.has(key) && (key.startsWith("task\u0000") ? parsed.name !== "omo.task.updated" : parsed.name !== "omo.dag.updated")) observation.states.delete(key);
      }
      return { ...conversation, live: { ...next, activityBaseline: observation.states,
        activityLog: observation.transitions.length === 0 ? live.activityLog : [...observation.transitions.reverse(), ...live.activityLog].slice(0, 50) } };
    };
    switch (parsed.name) {
      case "omo.dag.updated": {
        const { truncatedRuns: _previous, ...rest } = live;
        const runs = Object.fromEntries(parsed.data.runs.map((run) => [run.run_id, run]));
        const dagActivity = Object.fromEntries(Object.entries(live.dagActivity).filter(([id]) => runs[id] !== undefined).map(([id, entries]) => [
          id, Object.fromEntries(Object.entries(entries).filter(([nodeId]) => runs[id]?.nodes.some((node) => node.id === nodeId))),
        ]));
        return observed({ ...rest, freshness: "live", runs, runOrder: parsed.data.runs.map((run) => run.run_id), dagActivity,
          runsSource: "live", dagRevision: live.dagRevision + 1,
          ...(parsed.data.truncated_runs === undefined ? {} : { truncatedRuns: parsed.data.truncated_runs }) });
      }
      case "omo.task.updated": {
        const { truncatedTasks: _previous, ...rest } = live;
        return observed({ ...rest, freshness: "live",
          tasks: Object.fromEntries(parsed.data.tasks.map((task) => [task.task_id, task])), taskOrder: parsed.data.tasks.map((task) => task.task_id),
          ...(parsed.data.truncated_tasks === undefined ? {} : { truncatedTasks: parsed.data.truncated_tasks }) });
      }
      case "omo.dag.activity": {
        const activity = parsed.data;
        return observed({ ...live, dagActivity: { ...live.dagActivity,
          [activity.runId]: { ...live.dagActivity[activity.runId], [activity.nodeId]: activity } } });
      }
      case "omo.dag.heartbeat":
        return { ...conversation, live: { ...live, heartbeat: parsed.data } };
    }
  });
}
