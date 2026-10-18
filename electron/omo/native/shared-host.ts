import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import type { Socket } from "node:net";
import path from "node:path";

export interface SharedHost {
  socket: string;
  action: string;
  instanceId: string | null;
}

export class SharedHostUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedHostUnavailable";
  }
}

export type ExecFileImpl = (
  file: string,
  args: readonly string[],
  options: { cwd: string; env: Record<string, string>; timeout: number; windowsHide: boolean },
  callback: (error: (Error & { code?: unknown }) | null, stdout: string, stderr: string) => void,
) => unknown;

const ENSURE_TIMEOUT_MS = 60_000;
const SECRET_BYTES = 32;
const WINDOWS_PIPE_PREFIX = "\\\\.\\pipe\\senpi-rpc-";

/**
 * Attaches to, or starts, omo's shared host with `omo host ensure --policy never`: a host that is already
 * serving is never handed off, so another app using it keeps its sessions.
 */
export function ensureSharedHost(command: string, cwd: string, env: Record<string, string>, exec: ExecFileImpl = execFile as unknown as ExecFileImpl): Promise<SharedHost> {
  const nodeScript = process.platform === "win32" && /\.mjs$/i.test(command);
  const args = ["host", "ensure", "--json", "--policy", "never"];
  return new Promise((resolve, reject) => {
    exec(nodeScript ? process.execPath : command, nodeScript ? [command, ...args] : args,
      { cwd, env: nodeScript ? { ...env, ELECTRON_RUN_AS_NODE: "1" } : env, timeout: ENSURE_TIMEOUT_MS, windowsHide: true },
      (error, stdout, stderr) => {
        const line = stdout.trim().split(/\r?\n/).at(-1) ?? "";
        let answer: Record<string, unknown> | null = null;
        try {
          const parsed: unknown = JSON.parse(line);
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) answer = parsed as Record<string, unknown>;
        } catch (parseError) {
          void parseError;
        }
        const socket = answer?.["socket"];
        if (error === null && answer !== null && typeof socket === "string" && socket !== "") {
          resolve({ socket, action: String(answer["action"]), instanceId: typeof answer["instanceId"] === "string" ? answer["instanceId"] : null });
          return;
        }
        const reason = answer === null ? null : [answer["reason"], answer["detail"]].filter(part => typeof part === "string").join(": ");
        const exit = error === null ? "" : ` (exit ${String(error.code ?? error.message)})`;
        reject(new SharedHostUnavailable(`omo host ensure failed${exit}: ${reason || stderr.trim().split(/\r?\n/).at(-1) || "no answer"}`));
      });
  });
}

/** omo's own mapping (socket-transport resolveSocketTransportAddress): win32 serves a socket path as a named pipe. */
export function transportAddress(socket: string, secret: Buffer, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32" || socket.toLowerCase().startsWith("\\\\.\\pipe\\")) return socket;
  const canonical = path.win32.normalize(socket).toLowerCase();
  const name = createHash("sha256").update(Buffer.concat([Buffer.from(canonical, "utf8"), secret])).digest("hex").slice(0, 32);
  return `${WINDOWS_PIPE_PREFIX}${name}`;
}

/** Opens the host socket and sends the 32-byte `<socket>.secret` handshake ahead of any JSONL the caller writes. */
export function connectSharedHost(socket: string, platform: NodeJS.Platform = process.platform): Socket {
  const secret = readFileSync(`${socket}.secret`);
  if (secret.length !== SECRET_BYTES) throw new SharedHostUnavailable(`invalid omo host secret beside ${socket}`);
  const stream = connect(transportAddress(socket, secret, platform));
  stream.write(secret);
  return stream;
}
