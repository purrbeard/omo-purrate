import type { Thread } from "../../../shared/protocol";
import { projectKey } from "./project-list";

/** Filter value of threads whose workspace is unknown (empty cwd). */
export const UNKNOWN_PROJECT = "";

export interface ArchiveGroup {
  /** projectKey of the workspace, or UNKNOWN_PROJECT. */
  key: string;
  cwd: string;
  threads: Thread[];
}

export function archiveKey(cwd: string | null | undefined): string {
  return cwd === null || cwd === undefined || cwd.trim() === "" ? UNKNOWN_PROJECT : projectKey(cwd);
}

export function archiveTitle(thread: Thread): string {
  return (thread.name ?? "").trim() || thread.preview.trim();
}

/**
 * Archived threads grouped by workspace: threads newest first (by updatedAt), groups ordered by their newest thread
 * with the unknown workspace last. `projectFilter` is an archiveKey (null keeps every project); `query` is a
 * case-insensitive title substring.
 */
export function groupArchived(threads: readonly Thread[], query: string, projectFilter: string | null): ArchiveGroup[] {
  const needle = query.trim().toLocaleLowerCase();
  const groups = new Map<string, ArchiveGroup>();
  const sorted = [...threads].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  for (const thread of sorted) {
    const key = archiveKey(thread.cwd);
    if (projectFilter !== null && key !== projectFilter) continue;
    if (needle !== "" && !archiveTitle(thread).toLocaleLowerCase().includes(needle)) continue;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { key, cwd: key === UNKNOWN_PROJECT ? "" : thread.cwd, threads: [thread] });
    else group.threads.push(thread);
  }
  return [...groups.values()].sort((a, b) => Number(a.key === UNKNOWN_PROJECT) - Number(b.key === UNKNOWN_PROJECT));
}

/** The distinct projects among the archived threads, in the order groupArchived lists them. */
export function archivedProjects(threads: readonly Thread[]): Array<{ key: string; cwd: string }> {
  return groupArchived(threads, "", null).map(({ key, cwd }) => ({ key, cwd }));
}
