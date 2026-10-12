import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";

export interface SessionWatcher {
  /** Watches `file` and reports changes as `reported` (the path the renderer knows); null stops watching. */
  set(file: string | null, reported: string | null): void;
  close(): void;
}

/**
 * Follows one session file that another omo process may append to. Changes arrive in bursts (one write per entry),
 * so each burst is reported once after `quietMs` without further events.
 */
export function createSessionWatcher(onChange: (reported: string) => void, quietMs = 250): SessionWatcher {
  let watcher: FSWatcher | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let target: { file: string; reported: string } | null = null;

  const stop = (): void => {
    watcher?.close();
    watcher = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const arm = (): void => {
    if (target === null) return;
    const current = target;
    try {
      watcher = watch(current.file, { persistent: false }, (event) => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          if (target === current) onChange(current.reported);
        }, quietMs);
        // A replaced file (rename) leaves the old handle watching nothing; follow the path again.
        if (event === "rename" && target === current) {
          watcher?.close();
          watcher = null;
          arm();
        }
      });
      watcher.on("error", (error) => {
        console.warn(`[omo-ui] session watch failed for ${current.file}`, error);
        if (target !== current) return;
        watcher?.close();
        watcher = null;
      });
    } catch (error) {
      // The file may not exist yet (a new thread before its first turn); the next set() retries.
      console.warn(`[omo-ui] could not watch ${current.file}`, error);
      watcher = null;
    }
  };

  return {
    set(file, reported) {
      if (file !== null && reported !== null && target?.file === file && watcher !== null) return;
      stop();
      target = file === null || reported === null ? null : { file, reported };
      arm();
    },
    close() {
      target = null;
      stop();
    },
  };
}
