import { execFile } from "node:child_process";
import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeHolders } from "../../shared/session-held";
import type { SessionHolder } from "../../shared/session-held";

export interface ProcessInfo { startedAtMs: number; parentPid: number | null }
export type StartTimes = (pids: readonly number[]) => Promise<Map<number, ProcessInfo>>;
export type ObserveProcessExit = (pid: number, startedAtMs: number, changed: () => void) => () => void;
const START_TOLERANCE_MS = 2_000;
const DEFAULT_TTL_MS = 10_000;
function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error !== null) reject(error); else resolve(stdout);
    });
  });
}
const WINDOWS_SCRIPT = (pids: readonly number[]): string => [
  `$ids = @(${pids.join(",")})`,
  "Get-CimInstance Win32_Process | Where-Object { $ids -contains [int]$_.ProcessId } | ForEach-Object {",
  "  $_.ProcessId.ToString() + ' ' + ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds().ToString() + ' ' + $_.ParentProcessId.ToString()",
  "}",
].join("\n");
export function parseWindowsStartTimes(output: string): Map<number, ProcessInfo> {
  const times = new Map<number, ProcessInfo>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (match !== null) times.set(Number(match[1]), { startedAtMs: Number(match[2]), parentPid: Number(match[3]) });
  }
  return times;
}
export function parsePsStartTimes(output: string): Map<number, ProcessInfo> {
  const times = new Map<number, ProcessInfo>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    const startedAt = match === null ? Number.NaN : Date.parse(match[3]!);
    if (match !== null && !Number.isNaN(startedAt)) times.set(Number(match[1]), { startedAtMs: startedAt, parentPid: Number(match[2]) });
  }
  return times;
}
export const processStartTimes: StartTimes = async (pids) => {
  if (pids.length === 0) return new Map();
  if (process.platform === "win32") return parseWindowsStartTimes(await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCRIPT(pids)]));
  const output = await new Promise<string>((resolve, reject) => {
    execFile("ps", ["-o", "pid=,ppid=,lstart=", "-p", pids.join(",")], { env: { ...process.env, LC_ALL: "C" } }, (error, stdout) => {
      if (error !== null && error.code !== 1) reject(error); else resolve(stdout);
    });
  });
  return parsePsStartTimes(output);
};
/** Wait on a Windows process handle, not socket failure or PID polling. Cancelling stops only our helper. */
export const observeProcessExit: ObserveProcessExit = (pid, startedAtMs, changed) => {
  if (process.platform !== "win32") return () => {};
  const abort = new AbortController();
  const script = [
    "[System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = 'BelowNormal'",
    `try { $p = [System.Diagnostics.Process]::GetProcessById(${pid}); $null = $p.Handle } catch { Write-Output 'OWNER_CHANGED'; exit 0 }`,
    `try { $start = ([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds(); if ([Math]::Abs($start - ${startedAtMs}) -gt ${START_TOLERANCE_MS}) { Write-Output 'OWNER_CHANGED'; exit 0 }; $p.WaitForExit(); Write-Output 'OWNER_CHANGED' } catch { exit 1 } finally { $p.Dispose() }`,
  ].join("\n");
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, signal: abort.signal }, (error, stdout) => {
    if (!abort.signal.aborted && error === null && stdout.trim() === "OWNER_CHANGED") changed();
  });
  return () => abort.abort();
};
interface HolderRecord { file: string; text: string; holder: SessionHolder }
async function readRecords(directory: string): Promise<HolderRecord[]> {
  let names: string[];
  try { names = await readdir(directory); } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const records: HolderRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(directory, name);
    try {
      const text = await readFile(file, "utf8");
      const holder = normalizeHolders([JSON.parse(text)])[0];
      if (holder !== undefined) records.push({ file, text, holder });
    } catch (error) {
      if (!(error instanceof SyntaxError) && !(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  return records;
}
export interface SessionHoldersOptions {
  ownPids(): readonly (number | null)[];
  startTimes?: StartTimes;
  observeExit?: ObserveProcessExit;
  ttlMs?: number;
  now?: () => number;
}
interface LeaseWatch { changed: () => void; processes: Map<string, () => void> }
/** Lease records are discovery evidence only. Native owns all reclamation and write fences. */
export class SessionHolders {
  private readonly cache = new Map<number, { info: ProcessInfo | null; readAtMs: number }>();
  private readonly watches = new Map<string, Set<LeaseWatch>>();
  private readonly startTimes: StartTimes;
  private readonly ttlMs: number;
  private readonly now: () => number;
  constructor(private readonly options: SessionHoldersOptions) {
    this.startTimes = options.startTimes ?? processStartTimes;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }
  async lookup(sessions: readonly { id: string; sessionPath: string }[]): Promise<Record<string, SessionHolder[]>> {
    const own = new Set(this.options.ownPids().filter((pid): pid is number => pid !== null));
    const records = await Promise.all(sessions.map(async ({ id, sessionPath }) => ({ id, sessionPath, records: (await readRecords(path.join(path.dirname(sessionPath), "session-holders", id))).filter(record => !own.has(record.holder.pid)) })));
    let processes: Map<number, ProcessInfo | null> | null;
    try { processes = await this.resolve([...new Set(records.flatMap(entry => entry.records.map(record => record.holder.pid)))]); } catch { processes = null; }
    const held: Record<string, SessionHolder[]> = {};
    for (const { id, sessionPath, records: candidates } of records) {
      const live: SessionHolder[] = [];
      const identities = new Map<string, SessionHolder>();
      for (const record of candidates) {
        let stable = false;
        try { stable = await readFile(record.file, "utf8") === record.text; } catch { /* Native admission decides a disappearing lease. */ }
        const holder = record.holder;
        const info = processes?.get(holder.pid);
        if (!stable || processes === null || holder.processStartedAtMs === undefined) {
          live.push({ pid: holder.pid, identity: "unverified" });
          continue;
        }
        if (info === undefined || info === null || Math.abs(info.startedAtMs - holder.processStartedAtMs) > START_TOLERANCE_MS) continue;
        if (info.parentPid !== null && own.has(info.parentPid)) continue;
        identities.set(`${holder.pid}:${holder.processStartedAtMs}`, holder);
        live.push(holder.hostSocket === undefined ? { pid: holder.pid, ...(holder.cwd === undefined ? {} : { cwd: holder.cwd }) } : { ...holder, identity: "verified" });
      }
      for (const lease of this.watches.get(path.resolve(sessionPath)) ?? []) {
        for (const [identity, stop] of lease.processes) if (!identities.has(identity)) { stop(); lease.processes.delete(identity); }
        for (const [identity, holder] of identities) if (!lease.processes.has(identity)) {
          lease.processes.set(identity, (this.options.observeExit ?? observeProcessExit)(holder.pid, holder.processStartedAtMs!, () => { this.cache.delete(holder.pid); lease.changed(); }));
        }
      }
      if (live.length > 0) held[id] = live;
    }
    return held;
  }
  /** Subscribe before reading state. Watch parent edges too, since Windows coalesces directory renames. */
  watch(sessionPath: string, changed: () => void): () => void {
    const key = path.resolve(sessionPath);
    const lease: LeaseWatch = { changed, processes: new Map() };
    const leases = this.watches.get(key) ?? new Set<LeaseWatch>();
    leases.add(lease);
    this.watches.set(key, leases);
    let watcher: FSWatcher | null = null;
    try {
      watcher = watch(path.dirname(sessionPath), { recursive: true }, () => { this.cache.clear(); changed(); });
      watcher.on("error", () => { this.cache.clear(); changed(); });
    } catch { /* Inaccessible paths remain read-only. */ }
    return () => {
      watcher?.close();
      for (const stop of lease.processes.values()) stop();
      lease.processes.clear();
      leases.delete(lease);
      if (leases.size === 0) this.watches.delete(key);
    };
  }
  private async resolve(pids: readonly number[]): Promise<Map<number, ProcessInfo | null>> {
    const now = this.now();
    const stale = pids.filter(pid => { const entry = this.cache.get(pid); return entry === undefined || now - entry.readAtMs >= this.ttlMs; });
    if (stale.length > 0) {
      const found = await this.startTimes(stale);
      for (const pid of stale) this.cache.set(pid, { info: found.get(pid) ?? null, readAtMs: now });
    }
    return new Map(pids.map(pid => [pid, this.cache.get(pid)?.info ?? null]));
  }
}
