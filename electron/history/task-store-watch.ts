import { watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface TaskStoreWatcher {
  close(): void;
}

/** Files whose change can move a task, a run or a child's transcript: tasks/*.json, dag/**, children/<task>/sessions/**. */
async function files(directory: string, depth: number, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return;
    throw error;
  }
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && depth > 0) await files(file, depth - 1, out);
    else if (entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".jsonl"))) out.push(file);
  }
}

/** A cheap fingerprint of the store for the polling fallback; null while the store does not exist. */
export async function storeSignature(store: string): Promise<string | null> {
  try {
    if (!(await stat(store)).isDirectory()) return null;
  } catch {
    return null;
  }
  const found: string[] = [];
  await files(path.join(store, "tasks"), 0, found);
  await files(path.join(store, "dag"), 3, found);
  await files(path.join(store, "children"), 4, found);
  const stamps = await Promise.all(found.sort().map(async (file) => {
    try {
      const info = await stat(file);
      return `${file}:${info.size}:${info.mtimeMs}`;
    } catch {
      return `${file}:gone`; // A live writer replaced it between the listing and the stat.
    }
  }));
  return stamps.join("\n");
}

/**
 * Follows one native task store that another omo process writes. Writes arrive in bursts, so each burst is reported
 * once after `quietMs`. When a recursive fs.watch cannot be armed (the store does not exist yet, the platform refuses,
 * or the watcher fails) a poll of the store's file fingerprint every `pollMs` takes over until a watch can be armed.
 */
export function watchTaskStore(store: string, onChange: () => void, { quietMs = 300, pollMs = 2_000 } = {}): TaskStoreWatcher {
  let closed = false;
  let watcher: FSWatcher | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let quiet: ReturnType<typeof setTimeout> | null = null;
  let signature: string | null | undefined;

  const report = (): void => {
    if (quiet !== null) clearTimeout(quiet);
    quiet = setTimeout(() => {
      quiet = null;
      if (!closed) onChange();
    }, quietMs);
  };
  const stopPolling = (): void => {
    if (poll !== null) clearInterval(poll);
    poll = null;
  };
  const tick = async (): Promise<void> => {
    let next: string | null;
    try {
      next = await storeSignature(store);
    } catch (error) {
      console.warn(`[omo-ui] task store poll failed for ${store}`, error);
      return;
    }
    if (closed) return;
    if (signature !== undefined && next !== signature) report();
    signature = next;
    if (next !== null && watcher === null) arm();
  };
  const startPolling = (): void => {
    if (poll !== null || closed) return;
    void tick();
    poll = setInterval(() => void tick(), pollMs);
    poll.unref?.();
  };
  function arm(): void {
    if (closed) return;
    try {
      watcher = watch(store, { recursive: true, persistent: false }, () => report());
    } catch {
      watcher = null;
      startPolling();
      return;
    }
    stopPolling();
    watcher.on("error", (error) => {
      console.warn(`[omo-ui] task store watch failed for ${store}; polling instead`, error);
      watcher?.close();
      watcher = null;
      if (!closed) {
        signature = undefined;
        startPolling();
      }
    });
  }

  arm();
  return {
    close() {
      closed = true;
      watcher?.close();
      watcher = null;
      stopPolling();
      if (quiet !== null) clearTimeout(quiet);
      quiet = null;
    },
  };
}
