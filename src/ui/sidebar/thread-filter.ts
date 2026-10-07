import type { ThreadSummary, WorkspaceGroup } from "../../state";

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
  return thread.status.type === "active" || (thread.children?.some(isRunning) ?? false)
    || (thread.tasks?.some(task => task.status === "running") ?? false);
}

/** True when the trimmed, case-insensitive `query` is empty or occurs in the thread's name, preview, or `title`. */
export function threadMatches(thread: ThreadSummary, title: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return true;
  return [title, thread.name ?? "", thread.preview].some((text) => text.toLocaleLowerCase().includes(needle));
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

function threadPasses(thread: ThreadSummary, title: string, filter: ThreadFilter, nowMs: number): boolean {
  if (filter.runningOnly && !isRunning(thread)) return false;
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
): WorkspaceGroup[] {
  if (filter.query.trim() === "" && !filter.runningOnly && filter.period === "any") return [...groups];
  const result: WorkspaceGroup[] = [];
  for (const group of groups) {
    const matches = (thread: ThreadSummary): boolean => threadPasses(thread, titleOf(thread), filter, nowMs)
      || (thread.children?.some(matches) ?? false)
      || (filter.query.trim() !== "" && (thread.tasks?.some(task => task.title.toLowerCase().includes(filter.query.trim().toLowerCase())) ?? false));
    const threads = group.threads.filter(matches);
    if (threads.length > 0) result.push({ ...group, threads });
  }
  return result;
}
