import type { RequestId } from "../../shared/protocol";
import type { AppState, Notice, ThreadSummary } from "./types";

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function orderThreads(threads: Record<string, ThreadSummary>, previous: string[]): string[] {
  const order = Object.values(threads)
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    .map((summary) => summary.id);
  return sameIds(order, previous) ? previous : order;
}

export function withThreads(state: AppState, threads: Record<string, ThreadSummary>): AppState {
  return { ...state, threads, threadOrder: orderThreads(threads, state.threadOrder) };
}

export function upsertThread(state: AppState, summary: ThreadSummary): AppState {
  return withThreads(state, { ...state.threads, [summary.id]: summary });
}

export function updateThread(
  state: AppState,
  threadId: string,
  update: (summary: ThreadSummary) => ThreadSummary,
): AppState {
  const current = state.threads[threadId];
  if (current === undefined) return state;
  const next = update(current);
  return next === current ? state : upsertThread(state, next);
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => id !== key));
}

/** Sets an empty thread preview to `text`, matching the first-user-message preview omo reports in thread/list. */
export function fillEmptyPreview(state: AppState, threadId: string, text: string): AppState {
  const preview = text.trim();
  if (preview === "") return state;
  return updateThread(state, threadId, (summary) => (summary.preview.trim() === "" ? { ...summary, preview } : summary));
}

export function removeThread(state: AppState, threadId: string): AppState {
  const hasPending = state.pendingRequests.some((request) => request.threadId === threadId);
  const known =
    state.threads[threadId] !== undefined || state.conversations[threadId] !== undefined || hasPending;
  if (!known && state.activeThreadId !== threadId) return state;
  return {
    ...withThreads(state, without(state.threads, threadId)),
    threadOrigins: without(state.threadOrigins, threadId),
    conversations: without(state.conversations, threadId),
    pendingRequests: hasPending
      ? state.pendingRequests.filter((request) => request.threadId !== threadId)
      : state.pendingRequests,
    activeThreadId: state.activeThreadId === threadId ? null : state.activeThreadId,
  };
}

export function dropRequest(state: AppState, id: RequestId): AppState {
  const pendingRequests = state.pendingRequests.filter((request) => request.id !== id);
  return pendingRequests.length === state.pendingRequests.length ? state : { ...state, pendingRequests };
}

export function pushNotice(state: AppState, notice: Notice): AppState {
  return { ...state, notices: [...state.notices.filter((existing) => existing.id !== notice.id), notice] };
}
