import { spawn } from "node:child_process";
import type { TerminalChunk, TerminalExit, TerminalSnapshot } from "../../shared/workbench";
import { WORKBENCH_IPC } from "../../shared/workbench";
import type { SpawnImpl } from "../omo/app-server-client";
import { killInstallerProcess } from "../omo/installer";
import { ManagedChild } from "../omo/managed-child";
import { scrubChildEnv } from "../omo/shell-env";
import { threadId, workspace } from "./validation";

interface TerminalDeps {
  getLoginEnv: () => Promise<Record<string, string>>;
  send: (channel: string, payload: TerminalChunk | TerminalExit) => void;
  spawnImpl?: SpawnImpl;
}

interface Session {
  child: ManagedChild;
  cwd: string;
  output: TerminalChunk[];
  bytes: number;
  kill: Promise<void> | null;
}

const OUTPUT_LIMIT = 200 * 1024;

export function createTerminals(deps: TerminalDeps) {
  const sessions = new Map<string, Session>();
  const opening = new Map<string, Promise<TerminalSnapshot>>();
  let disposed = false;
  const snapshot = (id: string, session: Session): TerminalSnapshot => ({
    threadId: id, cwd: session.cwd, running: !session.child.hasExited, output: [...session.output],
  });
  const append = (id: string, session: Session, stream: TerminalChunk["stream"], text: string): void => {
    const chunk: TerminalChunk = { threadId: id, stream, text };
    // UTF-16 length is bounded as well as chunk count, including a single large write.
    const retained = text.length * 2 > OUTPUT_LIMIT ? { ...chunk, text: text.slice(-OUTPUT_LIMIT / 2) } : chunk;
    session.output.push(retained);
    session.bytes += retained.text.length * 2;
    while (session.output.length > 400 || session.bytes > OUTPUT_LIMIT) {
      session.bytes -= session.output.shift()!.text.length * 2;
    }
    deps.send(WORKBENCH_IPC.terminalChunk, chunk);
  };
  const killSession = (session: Session): Promise<void> => {
    session.kill ??= (async () => {
      if (!session.child.hasExited) await killInstallerProcess(session.child.process, process.platform);
      await session.child.exited;
    })();
    return session.kill;
  };
  const start = async (id: string, requestedCwd: unknown): Promise<TerminalSnapshot> => {
    const cwd = await workspace(requestedCwd);
    if (disposed) throw new Error("Workbench terminals are disposed");
    const existing = sessions.get(id);
    if (existing && !existing.child.hasExited) return snapshot(id, existing);
    const env = scrubChildEnv(await deps.getLoginEnv());
    if (disposed) throw new Error("Workbench terminals are disposed");
    const windows = process.platform === "win32";
    const processChild = (deps.spawnImpl ?? spawn)(windows ? "powershell.exe" : process.env["SHELL"] || "/bin/sh",
      windows ? ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "-"] : [],
      { cwd, env, stdio: "pipe", windowsHide: true, detached: !windows });
    const child = new ManagedChild(processChild, (code) => {
      append(id, session, "system", `Shell exited (${code ?? "unknown"})\n`);
      deps.send(WORKBENCH_IPC.terminalExit, { threadId: id, code });
    });
    const session: Session = { child, cwd, output: [], bytes: 0, kill: null };
    sessions.set(id, session);
    for (const stream of ["stdout", "stderr"] as const) {
      processChild[stream].setEncoding("utf8");
      processChild[stream].on("data", (text: string) => append(id, session, stream, text));
    }
    await new Promise<void>((resolve, reject) => {
      processChild.once("spawn", resolve);
      processChild.once("error", reject);
    });
    if (windows) processChild.stdin.write("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8\n");
    return snapshot(id, session);
  };
  return {
    terminalOpen: async (requestedId: unknown, cwd: unknown): Promise<TerminalSnapshot> => {
      const id = threadId(requestedId);
      const pending = opening.get(id);
      if (pending) {
        await workspace(cwd);
        return pending;
      }
      const promise = start(id, cwd).finally(() => opening.delete(id));
      opening.set(id, promise);
      return promise;
    },
    terminalWrite: async (requestedId: unknown, line: unknown): Promise<void> => {
      const id = threadId(requestedId);
      if (typeof line !== "string" || line.length > 8_000) throw new Error("Terminal line must be a string of at most 8000 characters");
      const session = sessions.get(id);
      if (disposed || !session || session.child.hasExited || session.kill) throw new Error("Terminal is not running");
      await new Promise<void>((resolve, reject) => {
        session.child.process.stdin.write(`${line}\n`, (error) => error ? reject(error) : resolve());
      });
    },
    terminalKill: async (requestedId: unknown): Promise<void> => {
      const id = threadId(requestedId);
      const pending = opening.get(id);
      if (pending) await pending;
      const session = sessions.get(id);
      if (session) await killSession(session);
    },
    dispose: async (): Promise<void> => {
      disposed = true;
      await Promise.allSettled([...opening.values()]);
      await Promise.all([...sessions.values()].map(killSession));
      sessions.clear();
    },
  };
}
