import type { AppState, ThreadSummary, WorkspaceGroup } from "../../state";
import { isSuspended } from "../conversation/activity-model";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How recently a listed thread must have been updated: any time, since local midnight, or within the last 7 or 30 days. */
export type ThreadPeriod = "any" | "today" | "week" | "month";

/** What the sidebar list keeps: threads matching the search text, only running ones when `runningOnly`, updated within `period`. */
export interface ThreadFilter {
  query: string;
  runningOnly: boolean;
  period: ThreadPeriod;
}

/** True while omo reports a running turn in the thread. */
export function isRunning(thread: ThreadSummary): boolean {
  return running(thread);
}

/** Runtime badges and filters must not promote persisted task records or disconnected snapshots to live work. */
export function isLiveRunning(thread: ThreadSummary, state: Pick<AppState, "bridge" | "conversations">): boolean {
  return running(thread, state);
}

function running(thread: ThreadSummary, state?: Pick<AppState, "bridge" | "conversations">): boolean {
  if (state !== undefined && state.bridge?.state !== "connected") return false;
  const live = state?.conversations[thread.id]?.live;
  const ownRunning = thread.status.type === "active" && (state === undefined || live === undefined || live.freshness === "live" ||
    state.conversations[thread.id]?.turns.some(turn => turn.id === state.conversations[thread.id]?.activeTurnId && turn.origin === "live" && turn.status === "inProgress") === true);
  const tasksRunning = state === undefined
    ? thread.tasks?.some(task => task.status === "running") ?? false
    : live?.freshness === "live" && Object.values(live.tasks).some(task => task.status === "running" && !isSuspended(task));
  return ownRunning || tasksRunning || (thread.children?.some(child => running(child, state)) ?? false);
}

/** Includes nested related sessions, whose workspace can differ from the root's workspace. */
export function containsThread(thread: ThreadSummary, threadId: string): boolean {
  return thread.id === threadId || (thread.children?.some(child => containsThread(child, threadId)) ?? false);
}

/** True when the trimmed, case-insensitive `query` is empty or occurs in the thread's name, preview, or `title`. */
export function threadMatches(thread: ThreadSummary, title: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return true;
  return [title, thread.name ?? "", thread.preview, ...(thread.tasks?.map(task => task.title) ?? [])]
    .some((text) => text.toLocaleLowerCase().includes(needle));
}

function periodStart(period: ThreadPeriod, nowMs: number): number | null {
  switch (period) {
    case "any":
      return null;
    case "today":
      return new Date(nowMs).setHours(0, 0, 0, 0);
    case "week":
      return nowMs - 7 * DAY_MS;
    case "month":
      return nowMs - 30 * DAY_MS;
  }
}

function threadPasses(thread: ThreadSummary, title: string, filter: ThreadFilter, nowMs: number, runningOf: (thread: ThreadSummary) => boolean): boolean {
  if (filter.runningOnly && !runningOf(thread)) return false;
  const start = periodStart(filter.period, nowMs);
  if (start !== null && thread.updatedAt < start) return false;
  return threadMatches(thread, title, filter.query);
}

/**
 * Keeps only the threads that pass every part of `filter` at `nowMs` ("today" starts at local midnight, the other periods
 * count back 7 or 30 days); groups left without threads are dropped.
 */
export function filterGroups(
  groups: readonly WorkspaceGroup[],
  filter: ThreadFilter,
  nowMs: number,
  titleOf: (thread: ThreadSummary) => string,
  runningOf: (thread: ThreadSummary) => boolean = isRunning,
): WorkspaceGroup[] {
  if (filter.query.trim() === "" && !filter.runningOnly && filter.period === "any") return [...groups];
  const result: WorkspaceGroup[] = [];
  for (const group of groups) {
    const matches = (thread: ThreadSummary): boolean => threadPasses(thread, titleOf(thread), filter, nowMs, runningOf)
      || (thread.children?.some(matches) ?? false)
      || (filter.query.trim() !== "" && threadPasses(thread, "", { ...filter, query: "" }, nowMs, runningOf)
        && (thread.tasks?.some(task => task.title.toLocaleLowerCase().includes(filter.query.trim().toLocaleLowerCase())) ?? false));
    const threads = group.threads.filter(matches);
    if (threads.length > 0) result.push({ ...group, threads });
  }
  return result;
}
