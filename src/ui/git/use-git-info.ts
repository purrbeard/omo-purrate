import { useEffect, useState } from "react";
import type { GitInfo } from "../../../shared/ipc";
import { useAppSelector } from "../app-context";
import type { AppState, Conversation } from "../../state";

/** Window event dispatched after UI-side git writes so every mounted git view re-reads its facts. */
export const GIT_REFRESH_EVENT = "omo:git-refresh";

/** Completed turns per turn list; a streamed delta replaces only the active thread's list, so the others are reused. */
const completedByTurns = new WeakMap<Conversation["turns"], number>();

/** Bumps whenever any thread's turn finishes; git facts refresh after each completed turn. */
export function selectCompletedTurnCount(state: AppState): number {
  let count = 0;
  for (const { turns } of Object.values(state.conversations)) {
    let completed = completedByTurns.get(turns);
    if (completed === undefined) {
      completed = turns.reduce((total, turn) => total + (turn.status === "completed" ? 1 : 0), 0);
      completedByTurns.set(turns, completed);
    }
    count += completed;
  }
  return count;
}

/**
 * Git facts of `cwd`, refreshed when the thread changes, after each completed turn, and on every
 * `GIT_REFRESH_EVENT`. Resolves null while loading or when the directory is not a git work tree;
 * stale facts from a previous cwd are never shown.
 */
export function useGitInfo(cwd: string | null): GitInfo | null {
  const [entry, setEntry] = useState<{ cwd: string; info: GitInfo | null } | null>(null);
  const completedTurns = useAppSelector(selectCompletedTurnCount);

  useEffect(() => {
    if (cwd === null) return;
    let current = true;
    const read = (): void => {
      window.omo
        .gitInfo(cwd)
        .then((info) => {
          if (current) setEntry({ cwd, info });
        })
        .catch((error: unknown) => {
          if (current) {
            console.warn("Could not read git facts", error);
            setEntry({ cwd, info: null });
          }
        });
    };
    read();
    window.addEventListener(GIT_REFRESH_EVENT, read);
    return () => {
      current = false;
      window.removeEventListener(GIT_REFRESH_EVENT, read);
    };
  }, [cwd, completedTurns]);

  return entry !== null && entry.cwd === cwd ? entry.info : null;
}
