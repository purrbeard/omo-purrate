import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { SessionHolder } from "../../shared/session-held";

/** A live process's creation time in epoch ms and its parent pid (null when the platform does not say). */
export interface ProcessInfo {
  startedAtMs: number;
  parentPid: number | null;
}

/** Live processes by pid; a pid that does not exist is absent. */
export type StartTimes = (pids: readonly number[]) => Promise<Map<number, ProcessInfo>>;

/** How far a holder record's `processStartedAtMs` may differ from the live process's creation time. */
const START_TOLERANCE_MS = 2_000;
const DEFAULT_TTL_MS = 10_000;

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error !== null) reject(error);
      else resolve(stdout);
    });
  });
}

const WINDOWS_SCRIPT = (pids: readonly number[]): string => [
  `$ids = @(${pids.join(",")})`,
  "Get-CimInstance Win32_Process | Where-Object { $ids -contains [int]$_.ProcessId } | ForEach-Object {",
  "  $_.ProcessId.ToString() + ' ' + ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds().ToString() + ' ' + $_.ParentProcessId.ToString()",
  "}",
].join("\n");

/** Parses `<pid> <epoch ms> <parent pid>` lines. */
export function parseWindowsStartTimes(output: string): Map<number, ProcessInfo> {
  const times = new Map<number, ProcessInfo>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (match !== null) times.set(Number(match[1]), { startedAtMs: Number(match[2]), parentPid: Number(match[3]) });
  }
  return times;
}

/** Parses `ps -o pid=,ppid=,lstart=` lines such as `  123     1 Mon Oct 20 12:34:56 2026`. */
export function parsePsStartTimes(output: string): Map<number, ProcessInfo> {
  const times = new Map<number, ProcessInfo>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    const startedAt = match === null ? Number.NaN : Date.parse(match[3]!);
    if (match !== null && !Number.isNaN(startedAt)) times.set(Number(match[1]), { startedAtMs: startedAt, parentPid: Number(match[2]) });
  }
  return times;
}

/** One batched process query per call: PowerShell CIM on Windows, `ps` elsewhere. */
export const processStartTimes: StartTimes = async (pids) => {
  if (pids.length === 0) return new Map();
  if (process.platform === "win32") {
    const output = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCRIPT(pids)]);
    return parseWindowsStartTimes(output);
  }
  // ps exits 1 when none of the pids exist; its stdout is still what was found.
  const output = await new Promise<string>((resolve) => {
    execFile("ps", ["-o", "pid=,ppid=,lstart=", "-p", pids.join(",")], { env: { ...process.env, LC_ALL: "C" } }, (_error, stdout) => resolve(stdout));
  });
  return parsePsStartTimes(output);
};

interface HolderRecord {
  pid: number;
  processStartedAtMs: number;
  cwd?: string;
}

async function readRecords(directory: string): Promise<HolderRecord[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const records: HolderRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const value: unknown = JSON.parse(await readFile(path.join(directory, name), "utf8"));
      if (typeof value !== "object" || value === null) continue;
      const { pid, processStartedAtMs, cwd } = value as Record<string, unknown>;
      if (typeof pid !== "number" || typeof processStartedAtMs !== "number") continue;
      records.push({ pid, processStartedAtMs, ...(typeof cwd === "string" ? { cwd } : {}) });
    } catch {
      // A half-written or foreign file is not a holder.
    }
  }
  return records;
}

export interface SessionHoldersOptions {
  /**
   * Pids that never count as foreign holders: this app and its omo child. Their direct children are ours too: the
   * `omo` launcher starts the versioned runtime, and the runtime's pid is the one omo writes into holder records.
   */
  ownPids(): readonly (number | null)[];
  startTimes?: StartTimes;
  ttlMs?: number;
  now?: () => number;
}

/**
 * Finds the live foreign holders of sessions from omo's on-disk holder records
 * (`<project dir>/session-holders/<sessionId>/<pid>.json`). Records outlive their processes, so a record counts
 * only while its pid exists and that process was created when the record says (a reused pid does not match).
 * Process creation times are cached briefly so refreshes do not spawn a query each time.
 */
export class SessionHolders {
  private readonly cache = new Map<number, { info: ProcessInfo | null; readAtMs: number }>();
  private readonly startTimes: StartTimes;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly options: SessionHoldersOptions) {
    this.startTimes = options.startTimes ?? processStartTimes;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * @param sessions - session ids with their JSONL paths
   * @returns the live holders by session id; sessions nobody holds are absent
   */
  async lookup(sessions: readonly { id: string; sessionPath: string }[]): Promise<Record<string, SessionHolder[]>> {
    const own = new Set(this.options.ownPids().filter((pid): pid is number => pid !== null));
    const records = await Promise.all(sessions.map(async ({ id, sessionPath }) =>
      ({ id, records: (await readRecords(path.join(path.dirname(sessionPath), "session-holders", id))).filter((record) => !own.has(record.pid)) })));
    const processes = await this.resolve([...new Set(records.flatMap((entry) => entry.records.map((record) => record.pid)))]);
    const held: Record<string, SessionHolder[]> = {};
    for (const { id, records: candidates } of records) {
      const live = candidates.filter((record) => {
        const info = processes.get(record.pid);
        if (info === undefined || info === null || Math.abs(info.startedAtMs - record.processStartedAtMs) > START_TOLERANCE_MS) return false;
        return info.parentPid === null || !own.has(info.parentPid);
      });
      if (live.length > 0) held[id] = live.map((record) => ({ pid: record.pid, ...(record.cwd === undefined ? {} : { cwd: record.cwd }) }));
    }
    return held;
  }

  private async resolve(pids: readonly number[]): Promise<Map<number, ProcessInfo | null>> {
    const now = this.now();
    const fresh = (pid: number): boolean => {
      const entry = this.cache.get(pid);
      return entry !== undefined && now - entry.readAtMs < this.ttlMs;
    };
    const stale = pids.filter((pid) => !fresh(pid));
    if (stale.length > 0) {
      const found = await this.startTimes(stale);
      for (const pid of stale) this.cache.set(pid, { info: found.get(pid) ?? null, readAtMs: now });
    }
    return new Map(pids.map((pid) => [pid, this.cache.get(pid)?.info ?? null]));
  }
}
