import { spawn } from "node:child_process";
import type { SshDisk, SshGpu, SshSpecs, SshStatus } from "../../shared/servers";

export const PROBE_TIMEOUT_MS = 15_000;
/** Never prompt: no password or passphrase questions, a bounded connect, and new host keys accepted (changed ones refused). */
export const SSH_OPTIONS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "-o", "StrictHostKeyChecking=accept-new"] as const;

export interface SshRun {
  /** null when ssh was killed at the timeout or could not start. */
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  timedOut: boolean;
  spawnError: string | null;
}

export type RunSsh = (alias: string, command: string) => Promise<SshRun>;

/**
 * Runs `ssh <options> <alias> <command>` with no stdin and a hard timeout. A `.mjs` binary (the e2e fake) runs under
 * Electron's Node, like the omo overrides.
 */
export function createSshRunner(bin: string, env: NodeJS.ProcessEnv, timeoutMs = PROBE_TIMEOUT_MS): RunSsh {
  return (alias, command) => new Promise((resolve) => {
    const started = Date.now();
    const nodeScript = /\.mjs$/i.test(bin);
    const args = [...SSH_OPTIONS, "--", alias, command];
    const child = spawn(nodeScript ? process.execPath : bin, nodeScript ? [bin, ...args] : args, {
      env: nodeScript ? { ...env, ELECTRON_RUN_AS_NODE: "1" } : env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { if (stdout.length < 1_000_000) stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { if (stderr.length < 100_000) stderr += chunk; });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, ms: Date.now() - started, timedOut: false, spawnError: error.message });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? null : code, stdout, stderr, ms: Date.now() - started, timedOut, spawnError: null });
    });
  });
}

/** The stderr line that explains a failure; ssh's informational warnings are skipped. */
export function stderrLine(stderr: string): string | null {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "" && !/^Warning: Permanently added/i.test(line) && !/^\*\*/.test(line));
  return lines.find((line) => /denied|refused|timed out|resolve|unreachable|closed|reset|verification|no route|not known|failed/i.test(line)) ?? lines[0] ?? null;
}

/** Classifies an ssh run: exit 255 is ssh's own failure (auth or network); any other exit means the session ran. */
export function classify(run: SshRun): { status: SshStatus; message: string | null } {
  if (run.spawnError !== null) return { status: "unknown", message: run.spawnError };
  if (run.timedOut) return { status: "unreachable", message: `timed out after ${Math.round(run.ms / 1000)} s` };
  if (run.code !== 255) return { status: "online", message: null };
  const line = stderrLine(run.stderr);
  if (/permission denied|too many authentication failures|no supported authentication|authentication failed|no mutual signature/i.test(run.stderr)) {
    return { status: "auth-failed", message: line };
  }
  return { status: "unreachable", message: line };
}

const MARK = "@@omo@@";

/** One POSIX sh command line that prints each spec behind a marker; every part tolerates a missing tool. */
export const POSIX_PROBE = [
  "uname -s || exit 97",
  `echo ${MARK}hostname; hostname 2>/dev/null || uname -n`,
  `echo ${MARK}os; ( . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" ) || ( sw_vers -productName 2>/dev/null; sw_vers -productVersion 2>/dev/null ) | tr '\\n' ' '`,
  `echo ${MARK}kernel; uname -r`,
  `echo ${MARK}arch; uname -m`,
  `echo ${MARK}cores; nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null`,
  `echo ${MARK}cpu; ( grep -m1 -i 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2-; lscpu 2>/dev/null | grep -m1 'Model name' | cut -d: -f2-; sysctl -n machdep.cpu.brand_string 2>/dev/null ) | grep -v '^ *$' | head -n 1`,
  `echo ${MARK}mem; grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo 2>/dev/null || sysctl -n hw.memsize 2>/dev/null`,
  `echo ${MARK}disk; df -Pk / 2>/dev/null | tail -n 1`,
  `echo ${MARK}load; cat /proc/loadavg 2>/dev/null || sysctl -n vm.loadavg 2>/dev/null`,
  `echo ${MARK}uptime; cat /proc/uptime 2>/dev/null || sysctl -n kern.boottime 2>/dev/null`,
  `echo ${MARK}gpu; nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null`,
  `echo ${MARK}end`,
].join("; ");

/** Windows PowerShell reading the CIM classes and printing one JSON object. */
export const WINDOWS_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$os = Get-CimInstance Win32_OperatingSystem",
  "$cpu = @(Get-CimInstance Win32_Processor)",
  "$cs = Get-CimInstance Win32_ComputerSystem",
  "$disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { @{ id = $_.DeviceID; size = [double]$_.Size; free = [double]$_.FreeSpace } })",
  "$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { @{ name = $_.Name; ram = [double]$_.AdapterRAM } })",
  "$page = @(Get-CimInstance Win32_PageFileUsage)",
  "[pscustomobject]@{ hostname = $env:COMPUTERNAME; caption = $os.Caption; version = $os.Version; arch = $os.OSArchitecture;"
    + " cpu = @($cpu | ForEach-Object { $_.Name.Trim() }); cores = ($cpu | Measure-Object NumberOfLogicalProcessors -Sum).Sum;"
    + " load = ($cpu | Measure-Object LoadPercentage -Average).Average; ramTotalKb = [double]$os.TotalVisibleMemorySize; ramFreeKb = [double]$os.FreePhysicalMemory;"
    + " ramTotalBytes = [double]$cs.TotalPhysicalMemory; swapTotalMb = ($page | Measure-Object AllocatedBaseSize -Sum).Sum; swapUsedMb = ($page | Measure-Object CurrentUsage -Sum).Sum;"
    + " systemDrive = $env:SystemDrive; disks = $disks; gpus = $gpus; uptimeSeconds = [int]((Get-Date) - $os.LastBootUpTime).TotalSeconds } | ConvertTo-Json -Compress -Depth 4",
].join("; ");

/** `powershell -EncodedCommand` takes the script as base64 UTF-16LE, so no shell on either side re-quotes it. */
export const WINDOWS_PROBE = `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64")}`;

function sections(stdout: string): Map<string, string> {
  const result = new Map<string, string>();
  const parts = stdout.replace(/\r\n/g, "\n").split(MARK);
  result.set("system", (parts[0] ?? "").trim().split("\n").at(-1)?.trim() ?? "");
  for (const part of parts.slice(1)) {
    const newline = part.indexOf("\n");
    const name = (newline < 0 ? part : part.slice(0, newline)).trim();
    result.set(name, newline < 0 ? "" : part.slice(newline + 1).trim());
  }
  return result;
}

function count(value: string | undefined): number | null {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

/** @returns the specs a POSIX probe printed, or null when the output is not one (the host is not POSIX) */
export function parsePosix(stdout: string): SshSpecs | null {
  const parts = sections(stdout);
  if (!parts.has("end") || !parts.has("hostname")) return null;
  const meminfo = new Map([...(parts.get("mem") ?? "").matchAll(/^(\w+):\s+(\d+)\s*kB/gm)].map((match) => [match[1], Number(match[2]) / 1024]));
  const memBytes = meminfo.size === 0 ? count(parts.get("mem")) : null;
  const df = (parts.get("disk") ?? "").split(/\s+/);
  const disks: SshDisk[] = df.length >= 6 && Number.isFinite(Number(df[1]))
    ? [{ mount: df[5] ?? "/", totalGb: Number(df[1]) / 1024 / 1024, freeGb: Number(df[3]) / 1024 / 1024 }] : [];
  const load = parts.get("load") ?? "";
  const loadWords = load.replace(/[{}]/g, " ").trim().split(/\s+/).slice(0, 3);
  const uptimeText = parts.get("uptime") ?? "";
  const boot = /sec\s*=\s*(\d+)/.exec(uptimeText);
  const gpus: SshGpu[] = (parts.get("gpu") ?? "").split("\n").map((line) => line.trim()).filter((line) => line !== "").map((line) => {
    const [name = line, memory] = line.split(/,\s*/);
    return { name, memoryMb: count(memory) };
  });
  return {
    family: "posix",
    system: parts.get("system") ?? "",
    hostname: parts.get("hostname") ?? "",
    osName: (parts.get("os") ?? "").trim() || (parts.get("system") ?? ""),
    kernel: parts.get("kernel") ?? "",
    arch: parts.get("arch") ?? "",
    cpuModel: (parts.get("cpu") ?? "").trim() || null,
    cores: count(parts.get("cores")),
    ramTotalMb: meminfo.get("MemTotal") ?? (memBytes === null ? null : memBytes / 1024 / 1024),
    ramAvailableMb: meminfo.get("MemAvailable") ?? null,
    swapTotalMb: meminfo.get("SwapTotal") ?? null,
    swapFreeMb: meminfo.get("SwapFree") ?? null,
    disks,
    load: loadWords.length > 0 && loadWords[0] !== "" ? loadWords.join(" ") : null,
    uptimeSeconds: boot !== null ? Math.max(0, Math.round(Date.now() / 1000) - Number(boot[1])) : count(uptimeText.split(/\s+/)[0]),
    gpus,
  };
}

/** @returns the specs the Windows probe printed as JSON, or null when it printed something else */
export function parseWindows(stdout: string): SshSpecs | null {
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  let value: Record<string, unknown>;
  try { value = JSON.parse(stdout.slice(start)) as Record<string, unknown>; } catch { return null; }
  const text = (key: string): string => (typeof value[key] === "string" ? value[key] as string : "");
  const num = (key: string): number | null => (typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] as number : null);
  const list = (key: string): Record<string, unknown>[] => {
    const entry = value[key];
    return (Array.isArray(entry) ? entry : entry === null || entry === undefined ? [] : [entry]).filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  };
  const cpus = Array.isArray(value["cpu"]) ? value["cpu"].filter((item): item is string => typeof item === "string") : typeof value["cpu"] === "string" ? [value["cpu"]] : [];
  const system = text("systemDrive").toUpperCase();
  const disks = list("disks").map((disk) => ({ mount: String(disk["id"] ?? ""), totalGb: Number(disk["size"]) / 1024 ** 3, freeGb: Number(disk["free"]) / 1024 ** 3 }))
    .filter((disk) => disk.mount !== "" && Number.isFinite(disk.totalGb))
    .sort((a, b) => Number(b.mount.toUpperCase() === system) - Number(a.mount.toUpperCase() === system));
  const ramTotalKb = num("ramTotalKb");
  const swapTotal = num("swapTotalMb");
  const swapUsed = num("swapUsedMb");
  const load = num("load");
  return {
    family: "windows",
    system: "Windows",
    hostname: text("hostname"),
    osName: text("caption").replace(/^Microsoft\s+/i, "") || "Windows",
    kernel: text("version"),
    arch: text("arch"),
    cpuModel: cpus[0] === undefined ? null : cpus.length > 1 ? `${cpus.length} x ${cpus[0]}` : cpus[0],
    cores: num("cores"),
    ramTotalMb: ramTotalKb === null ? null : ramTotalKb / 1024,
    ramAvailableMb: num("ramFreeKb") === null ? null : num("ramFreeKb")! / 1024,
    swapTotalMb: swapTotal,
    swapFreeMb: swapTotal === null || swapUsed === null ? null : swapTotal - swapUsed,
    disks,
    load: load === null ? null : `${Math.round(load)}%`,
    uptimeSeconds: num("uptimeSeconds"),
    gpus: list("gpus").map((gpu) => ({ name: String(gpu["name"] ?? "").trim(), memoryMb: typeof gpu["ram"] === "number" && gpu["ram"] > 0 ? gpu["ram"] / 1024 / 1024 : null }))
      .filter((gpu) => gpu.name !== ""),
  };
}

export interface ProbeResult {
  status: SshStatus;
  message: string | null;
  latencyMs: number | null;
  specs: SshSpecs | null;
}

/** Connects with `echo ok` only, for status and latency. */
export async function testConnection(run: RunSsh, alias: string): Promise<ProbeResult> {
  const result = await run(alias, "echo ok");
  const { status, message } = classify(result);
  return { status, message, latencyMs: status === "online" ? result.ms : null, specs: null };
}

/** Runs the POSIX probe (which starts with `uname -s`); a host where that fails gets the Windows PowerShell probe. */
export async function probeSpecs(run: RunSsh, alias: string): Promise<ProbeResult> {
  const posix = await run(alias, POSIX_PROBE);
  const first = classify(posix);
  if (first.status !== "online") return { ...first, latencyMs: null, specs: null };
  const parsed = parsePosix(posix.stdout);
  if (parsed !== null) return { status: "online", message: null, latencyMs: posix.ms, specs: parsed };
  const windows = await run(alias, WINDOWS_PROBE);
  const second = classify(windows);
  if (second.status !== "online") return { ...second, latencyMs: null, specs: null };
  const specs = parseWindows(windows.stdout);
  return { status: "online", message: specs === null ? stderrLine(windows.stderr) ?? stderrLine(posix.stderr) : null, latencyMs: posix.ms, specs };
}

/** Runs at most `limit` tasks at once, in arrival order. */
export function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try { return await task(); } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}
