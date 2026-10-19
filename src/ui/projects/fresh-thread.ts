import { useSyncExternalStore } from "react";

/**
 * Threads started by the new-thread flow in this window. While such a thread has no turn yet, the composer shows
 * the project and environment chips above it; opening an existing empty thread from the sidebar does not.
 */
let fresh: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export const freshThreads = {
  mark(threadId: string): void {
    fresh = new Set([...fresh, threadId]);
    for (const listener of [...listeners]) listener();
  },
  has: (threadId: string | null): boolean => threadId !== null && fresh.has(threadId),
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** True when `threadId` was started by the new-thread flow. */
export function useFreshThread(threadId: string | null): boolean {
  return useSyncExternalStore(freshThreads.subscribe, () => freshThreads.has(threadId));
}
