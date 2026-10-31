import { lstat, opendir } from "node:fs/promises";
import path from "node:path";
import type { StorageCategory, StorageUsage, StorageUsageRow } from "../shared/storage";

// Bound metadata work and the number of pending directories across each root.
const MAX_ENTRIES = 100_000;
const MAX_DEPTH = 64;
const DAY_MS = 24 * 60 * 60 * 1_000;

type StorageOptions = {
  agentDir: string;
  userData: string;
  olderThanDays: number;
};

function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && "code" in error && error.code === "ENOENT";
}

async function scan(category: StorageCategory, base: string, name: string, cutoff: number): Promise<StorageUsageRow> {
  const row: StorageUsageRow = {
    category, state: "unavailable", count: 0, bytes: 0,
    candidateCount: 0, candidateBytes: 0, skipped: 0, errors: 0, incomplete: false,
  };
  let baseInfo;
  try {
    baseInfo = await lstat(base);
  } catch {
    row.errors++;
    row.incomplete = true;
    return row;
  }
  if (baseInfo.isSymbolicLink() || !baseInfo.isDirectory()) {
    row.skipped++;
    row.incomplete = true;
    return row;
  }
  const root = path.join(base, name);
  let rootInfo;
  try {
    rootInfo = await lstat(root);
  } catch (error: unknown) {
    if (missing(error)) row.state = "absent";
    else { row.errors++; row.incomplete = true; }
    return row;
  }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    row.skipped++;
    row.incomplete = true;
    return row;
  }
  row.state = "present";
  const pending: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  let entries = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    try {
      const dir = await opendir(current.dir);
      for await (const entry of dir) {
        if (entries >= MAX_ENTRIES) {
          row.incomplete = true;
          break;
        }
        entries++;
        const child = path.join(current.dir, entry.name);
        try {
          const info = await lstat(child);
          if (info.isSymbolicLink()) {
            row.skipped++;
          } else if (info.isFile()) {
            row.count++;
            row.bytes += info.size;
            if (info.mtimeMs < cutoff) {
              row.candidateCount++;
              row.candidateBytes += info.size;
            }
          } else if (info.isDirectory()) {
            if (current.depth >= MAX_DEPTH) {
              row.skipped++;
              row.incomplete = true;
            } else {
              pending.push({ dir: child, depth: current.depth + 1 });
            }
          } else {
            row.skipped++;
          }
        } catch {
          row.errors++;
          row.incomplete = true;
        }
      }
    } catch {
      row.errors++;
      row.incomplete = true;
    }
    if (entries >= MAX_ENTRIES && pending.length > 0) {
      row.incomplete = true;
      break;
    }
  }
  return row;
}

export async function readStorageUsage({ agentDir, userData, olderThanDays }: StorageOptions): Promise<StorageUsage> {
  if (!path.isAbsolute(agentDir) || !path.isAbsolute(userData)) throw new Error("Storage roots must be absolute");
  if (!Number.isInteger(olderThanDays) || olderThanDays < 1 || olderThanDays > 3650) {
    throw new Error("olderThanDays must be an integer between 1 and 3650");
  }
  const cutoff = Date.now() - olderThanDays * DAY_MS;
  const rows = await Promise.all([
    scan("sessions", agentDir, "sessions", cutoff),
    scan("attachments", userData, "attachments", cutoff),
    scan("screenshots", userData, "screenshots", cutoff),
  ]);
  return { olderThanDays, rows, incomplete: rows.some((row) => row.incomplete) };
}
