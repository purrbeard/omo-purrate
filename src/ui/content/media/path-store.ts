// Existence cache for paths mentioned in chat. Components ask for one absolute path each; requests made in the same
// tick leave as a single batched IPC call, and answers are cached so remounting a message costs nothing.

import { useEffect, useSyncExternalStore } from "react";
import { MAX_STAT_PATHS } from "../../../../shared/media";
import type { PathInfo } from "../../../../shared/media";

/** Existing paths stay valid for a long time; a missing one is re-checked soon because the agent may create it. */
const FOUND_TTL_MS = 10 * 60_000;
const MISSING_TTL_MS = 15_000;

interface Entry {
  /** null while the lookup is in flight. */
  info: PathInfo | null;
  at: number;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let queue = new Set<string>();
let scheduled = false;

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function fresh(entry: Entry): boolean {
  if (entry.info === null) return true;
  return Date.now() - entry.at < (entry.info.kind === "missing" ? MISSING_TTL_MS : FOUND_TTL_MS);
}

async function flush(): Promise<void> {
  scheduled = false;
  const batch = [...queue];
  queue = new Set();
  for (let offset = 0; offset < batch.length; offset += MAX_STAT_PATHS) {
    const chunk = batch.slice(offset, offset + MAX_STAT_PATHS);
    let infos: PathInfo[];
    try {
      infos = await window.omo.statPaths(chunk);
    } catch (error) {
      void error;
      infos = chunk.map(() => ({ kind: "missing" as const }));
    }
    const now = Date.now();
    chunk.forEach((path, index) => entries.set(path, { info: infos[index] ?? { kind: "missing" }, at: now }));
    notify();
  }
}

/**
 * Ask for the existence of an absolute path; the answer arrives through {@link usePathInfo}.
 * @param path - Absolute path.
 */
export function requestPathInfo(path: string): void {
  const known = entries.get(path);
  if (known !== undefined && fresh(known)) return;
  entries.set(path, { info: null, at: Date.now() });
  queue.add(path);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(() => void flush());
  }
}

/** Forget every cached answer (tests). */
export function resetPathInfoCache(): void {
  entries.clear();
  queue = new Set();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether an absolute path exists, as soon as the batched lookup answers.
 * @param path - Absolute path, or null when the candidate could not be resolved.
 * @returns null while unknown, otherwise what the path is.
 */
export function usePathInfo(path: string | null): PathInfo | null {
  const info = useSyncExternalStore(
    subscribe,
    () => (path === null ? null : (entries.get(path)?.info ?? null)),
    () => null,
  );
  useEffect(() => {
    if (path !== null) requestPathInfo(path);
  }, [path]);
  return info;
}
