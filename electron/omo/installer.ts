import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { OMO_INSTALL_SCRIPT_URL } from "../../shared/ipc";
import type { InstallLogLine, InstallResult } from "../../shared/ipc";
import type { SpawnImpl } from "./app-server-client";

export interface RunInstallerOptions {
  env: Record<string, string>;
  onLine: (line: InstallLogLine) => void;
  timeoutMs?: number;
  spawnImpl?: SpawnImpl;
  /** URL of the installer script; defaults to OMO_INSTALL_SCRIPT_URL. */
  scriptUrl?: string;
}

/**
 * Bash program that downloads the script at `$1` to a temp file and runs it with bash. Piping the official script
 * into bash, as OMO_INSTALL_COMMAND does, leaves BASH_SOURCE unset, so its `set -u` main guard exits 1 before
 * installing anything (bash 3.2 and 5.2).
 */
const INSTALL_PROGRAM = [
  'script="$(mktemp "${TMPDIR:-/tmp}/omo-install-sh.XXXXXX")" || exit 1',
  "trap 'rm -f \"$script\"' EXIT",
  'curl -fsSL "$1" -o "$script" && bash "$script"',
].join("\n");

function streamLines(stream: Readable, name: InstallLogLine["stream"], onLine: (line: InstallLogLine) => void): () => void {
  const utf8 = new StringDecoder("utf8");
  let buffer = "";
  const emit = (raw: string): void => {
    onLine({ stream: name, text: raw.endsWith("\r") ? raw.slice(0, -1) : raw });
  };
  stream.on("data", (chunk: Buffer) => {
    buffer += utf8.write(chunk);
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) emit(line);
  });
  return () => {
    const rest = buffer + utf8.end();
    buffer = "";
    if (rest !== "") emit(rest);
  };
}

/** Downloads and runs the installer script in a bash login shell, streaming output lines; a timeout kills the process group. */
export function runInstaller(options: RunInstallerOptions): Promise<InstallResult> {
  const timeoutMs = options.timeoutMs ?? 600_000;
  const spawnImpl = options.spawnImpl ?? spawn;
  const scriptUrl = options.scriptUrl ?? OMO_INSTALL_SCRIPT_URL;
  return new Promise((resolve) => {
    let settled = false;
    const child = spawnImpl("/bin/bash", ["-lc", INSTALL_PROGRAM, "omo-install", scriptUrl], {
      env: options.env,
      stdio: "pipe",
      detached: true,
    });
    const settle = (result: InstallResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      options.onLine({ stream: "stderr", text: `installer timed out after ${timeoutMs} ms` });
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          // ESRCH: the process group already exited.
          void error;
        }
      }
      settle({ ok: false, exitCode: null });
    }, timeoutMs);
    child.stdin.end();
    const flushStdout = streamLines(child.stdout, "stdout", options.onLine);
    const flushStderr = streamLines(child.stderr, "stderr", options.onLine);
    child.on("error", (error) => {
      options.onLine({ stream: "stderr", text: `installer failed to start: ${error.message}` });
      settle({ ok: false, exitCode: null });
    });
    child.on("close", (code) => {
      if (settled) return;
      flushStdout();
      flushStderr();
      settle({ ok: code === 0, exitCode: code });
    });
  });
}
