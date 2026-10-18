import { spawn } from "node-pty";
import { release } from "node:os";
import { ChildProcess } from "node:child_process";
import type { IPty, IPtyForkOptions } from "node-pty";
import type { TerminalChunk, TerminalExit, TerminalSnapshot } from "../../shared/workbench";
import { WORKBENCH_IPC } from "../../shared/workbench";
import { scrubChildEnv } from "../omo/shell-env";
import { killInstallerProcess } from "../omo/installer";
import { resolveTerminalShell } from "./terminal-shell";
import { threadId, workspace } from "./validation";

export type TerminalPty = Pick<IPty, "pid" | "write" | "resize" | "kill" | "onData" | "onExit">;
interface TerminalDeps {
  readonly getLoginEnv: () => Promise<Record<string, string>>;
  readonly send: (channel: string, payload: TerminalChunk | TerminalExit) => void;
  readonly spawnImpl?: (file: string, args: string[], options: IPtyForkOptions) => TerminalPty;
  readonly shellOverride?: string;
  readonly killTree?: (pid: number) => Promise<void>;
}

// A session owns the mutable process lifetime and the bounded replay buffer.
interface Session {
  readonly pty: TerminalPty;
  readonly cwd: string;
  readonly exited: Promise<void>;
  readonly finish: (code: number) => void;
  output: string;
  sequence: number;
  running: boolean;
  killing: boolean;
  kill: Promise<void> | null;
}

const OUTPUT_LIMIT = 200 * 1024;
const KILL_GRACE_MS = 1000;

export function createTerminals(deps: TerminalDeps) {
  const sessions = new Map<string, Session>();
  const opening = new Map<string, Promise<TerminalSnapshot>>();
  let disposed = false;
  const snapshot = (id: string, session: Session): TerminalSnapshot => ({
    threadId: id, cwd: session.cwd, running: session.running, sequence: session.sequence,
    ...(process.platform === "win32" ? { windowsBuild: Number(release().split(".")[2]) } : {}),
    output: session.output === "" ? [] : [{ threadId: id, sequence: session.sequence, stream: "stdout", text: session.output }],
  });
  const forceKill = deps.killTree ?? (async (pid: number): Promise<void> => {
    if (process.platform === "win32") {
      const child = new ChildProcess();
      Object.defineProperty(child, "pid", { value: pid });
      await killInstallerProcess(child, process.platform);
    } else {
      try { process.kill(-pid, "SIGKILL"); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
      }
    }
  });
  const killSession = (session: Session): Promise<void> => {
    session.kill ??= (async () => {
      if (!session.running) return;
      session.killing = true;
      try {
        let graceful = true;
        try { session.pty.kill(); }
        catch (error) {
          if (!(error instanceof Error)) throw error;
          graceful = false;
        }
        if (graceful && session.running) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([session.exited, new Promise<void>(resolve => { timer = setTimeout(resolve, KILL_GRACE_MS); })]);
          } finally { clearTimeout(timer); }
        }
        if (session.running) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([forceKill(session.pty.pid), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Terminal tree kill timed out")), KILL_GRACE_MS); })]);
          } finally { clearTimeout(timer); session.finish(-1); }
        }
      } finally { session.killing = false; }
    })().catch(error => { session.kill = null; throw error; });
    return session.kill;
  };
  const start = async (id: string, requestedCwd: unknown): Promise<TerminalSnapshot> => {
    const cwd = await workspace(requestedCwd);
    if (disposed) throw new Error("Workbench terminals are disposed");
    const existing = sessions.get(id);
    if (existing?.running) return snapshot(id, existing);
    const env = scrubChildEnv(await deps.getLoginEnv());
    const shell = await resolveTerminalShell({ platform: process.platform, env, ...(deps.shellOverride === undefined ? {} : { override: deps.shellOverride }) });
    if (disposed) throw new Error("Workbench terminals are disposed");
    const pty = (deps.spawnImpl ?? spawn)(shell.file, shell.args, {
      cwd, env: { ...env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      name: "xterm-256color", cols: 80, rows: 24,
    });
    let finish = (): void => {};
    const exited = new Promise<void>(resolve => { finish = resolve; });
    const session: Session = { pty, cwd, exited, finish: code => {
      if (!session.running) return;
      session.running = false;
      const text = `\r\n\u001b[2mShell exited (${code})\u001b[22m\r\n`;
      session.output = (session.output + text).slice(-OUTPUT_LIMIT / 2);
      session.sequence += 1;
      deps.send(WORKBENCH_IPC.terminalChunk, { threadId: id, sequence: session.sequence, stream: "stdout", text });
      deps.send(WORKBENCH_IPC.terminalExit, { threadId: id, code });
      dataSubscription.dispose(); exitSubscription.dispose(); finish();
    }, output: "", sequence: 0, running: true, killing: false, kill: null };
    sessions.set(id, session);
    const dataSubscription = pty.onData(text => {
      const raw = session.output + text;
      const start = Math.max(0, raw.length - OUTPUT_LIMIT / 2);
      const first = raw.charCodeAt(start);
      // A complete next line avoids starting inside an ANSI/OSC sequence when scrollback is trimmed.
      const newline = start > 0 ? raw.indexOf("\n", start) : -1;
      session.output = raw.slice(newline >= 0 ? newline + 1 : first >= 0xdc00 && first <= 0xdfff ? start + 1 : start);
      session.sequence += 1;
      deps.send(WORKBENCH_IPC.terminalChunk, { threadId: id, sequence: session.sequence, stream: "stdout", text });
    });
    const exitSubscription = pty.onExit(({ exitCode }) => session.finish(exitCode));
    return snapshot(id, session);
  };
  const runningSession = (requestedId: unknown): Session => {
    const session = sessions.get(threadId(requestedId));
    if (disposed || !session?.running || session.killing) throw new Error("Terminal is not running");
    return session;
  };
  return {
    terminalOpen: async (requestedId: unknown, cwd: unknown): Promise<TerminalSnapshot> => {
      const id = threadId(requestedId);
      const pending = opening.get(id);
      if (pending) { await workspace(cwd); return pending; }
      const promise = start(id, cwd).finally(() => opening.delete(id));
      opening.set(id, promise);
      return promise;
    },
    terminalWrite: async (requestedId: unknown, data: unknown): Promise<void> => {
      if (typeof data !== "string" || data.length > 8_000) throw new Error("Terminal data must be a string of at most 8000 characters");
      runningSession(requestedId).pty.write(data);
    },
    terminalResize: async (requestedId: unknown, cols: unknown, rows: unknown): Promise<void> => {
      if (typeof cols !== "number" || typeof rows !== "number" || !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols > 1000 || rows > 1000) throw new Error("Terminal dimensions must be positive integers at most 1000");
      runningSession(requestedId).pty.resize(cols, rows);
    },
    terminalKill: async (requestedId: unknown): Promise<void> => {
      const id = threadId(requestedId);
      await opening.get(id);
      const session = sessions.get(id);
      if (session) await killSession(session);
    },
    dispose: async (): Promise<void> => {
      disposed = true;
      await Promise.allSettled([...opening.values()]);
      await Promise.allSettled([...sessions.values()].map(killSession));
      sessions.clear();
    },
  };
}
