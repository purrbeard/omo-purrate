import { spawn } from "node:child_process";
import type { Socket } from "node:net";
import type { SpawnImpl } from "../app-server-client";
import { JsonlDecoder } from "../jsonl";
import { ManagedChild } from "../managed-child";
import type { ExitInfo, StopTimeouts } from "../managed-child";
import { SESSION_HELD_CODE, sessionHeldMessage } from "../../../shared/session-held";
import { BRIDGE_ERROR_CODES, describeExit, RpcRequestError } from "../rpc";
import { connectSharedHost } from "./shared-host";

export type NativeRecord = Record<string, unknown> & { type: string };

/**
 * A native command refused with `success: false`; errorCode/errorData are kept for callers that branch on them.
 * A `session_held` refusal carries its holders in the message, because only the message survives the Electron IPC bridge.
 */
export class NativeCommandError extends RpcRequestError {
  constructor(
    readonly command: string,
    message: string,
    readonly errorCode: string | undefined,
    readonly errorData: unknown,
  ) {
    super(-32600, errorCode === SESSION_HELD_CODE ? sessionHeldMessage(errorData) : message, errorCode === undefined ? undefined : { errorCode, errorData });
    this.name = "NativeCommandError";
  }
}

export interface NativeConnectionOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
  spawnImpl?: SpawnImpl;
  /** A shared host's socket; when set, the connection attaches to it instead of spawning `command`. */
  socket?: string;
  connectImpl?: (socket: string) => Socket;
}

/** What a connection needs from its transport: an omo child over stdio, or a shared host socket. */
interface Link {
  readonly pid: number | null;
  readonly hasExited: boolean;
  readonly stderrTail: string;
  readonly spawnError: Error | null;
  readonly exited: Promise<ExitInfo>;
  readonly writable: boolean;
  write(text: string): void;
  stop(timeouts: StopTimeouts): Promise<void>;
}

function childLink(child: ManagedChild): Link {
  return {
    get pid() { return child.process.pid ?? null; },
    get hasExited() { return child.hasExited; },
    get stderrTail() { return child.stderrTail; },
    get spawnError() { return child.spawnError; },
    exited: child.exited,
    get writable() { return !child.hasExited && child.process.stdin.writable; },
    write: (text) => { child.process.stdin.write(text); },
    stop: (timeouts) => child.stop(timeouts),
  };
}

function socketLink(stream: Socket, onClosed: () => void): Link {
  let closed = false;
  let failure: Error | null = null;
  let stopRequested = false;
  let resolveExited: (info: ExitInfo) => void = () => undefined;
  const exited = new Promise<ExitInfo>((resolve) => { resolveExited = resolve; });
  stream.on("error", (error) => { failure ??= error; });
  stream.once("close", () => {
    closed = true;
    onClosed();
    resolveExited({ code: null, signal: null, stderrTail: failure === null ? "" : failure.message, expected: stopRequested });
  });
  return {
    pid: null,
    get hasExited() { return closed; },
    get stderrTail() { return failure?.message ?? ""; },
    get spawnError() { return failure; },
    exited,
    get writable() { return !closed && stream.writable; },
    write: (text) => { stream.write(text); },
    stop: async (timeouts) => {
      stopRequested = true;
      if (closed) return;
      stream.end();
      const timer = setTimeout(() => stream.destroy(), timeouts.afterStdinEnd);
      await exited;
      clearTimeout(timer);
    },
  };
}

interface Pending {
  command: string;
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One `omo --mode rpc` child: string-id commands with `type: "response"` answers, everything else is a record. */
export class NativeConnection {
  private child: Link | null = null;
  private readonly pending = new Map<string, Pending>();
  private nextId = 1;
  private readonly recordListeners = new Set<(record: NativeRecord) => void>();
  private readonly malformedListeners = new Set<(line: string, error: Error) => void>();
  private readonly exitListeners = new Set<(info: ExitInfo) => void>();

  constructor(private readonly options: NativeConnectionOptions) {}

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  get hasExited(): boolean {
    return this.child?.hasExited ?? false;
  }

  get stderrTail(): string {
    return this.child?.stderrTail ?? "";
  }

  get spawnError(): Error | null {
    return this.child?.spawnError ?? null;
  }

  get exited(): Promise<ExitInfo> | null {
    return this.child?.exited ?? null;
  }

  start(): void {
    if (this.child) throw new Error("NativeConnection.start() may only be called once");
    const decoder = new JsonlDecoder({
      onFrame: (value) => this.handle(value),
      onMalformed: (line, error) => this.emitMalformed(line, error),
    });
    const socket = this.options.socket;
    if (socket !== undefined) {
      const stream = (this.options.connectImpl ?? connectSharedHost)(socket);
      const link = socketLink(stream, () => {
        decoder.end();
        this.rejectPending(new RpcRequestError(BRIDGE_ERROR_CODES.notConnected, "the omo host closed the connection"));
      });
      this.child = link;
      stream.on("data", (chunk: Buffer) => decoder.push(chunk));
      void link.exited.then((info) => {
        for (const listener of [...this.exitListeners]) listener(info);
      });
      return;
    }
    const spawnImpl = this.options.spawnImpl ?? spawn;
    const nodeScript = process.platform === "win32" && /\.mjs$/i.test(this.options.command);
    const childProcess = spawnImpl(nodeScript ? process.execPath : this.options.command,
      nodeScript ? [this.options.command, ...this.options.args] : this.options.args, {
        cwd: this.options.cwd,
        env: nodeScript ? { ...this.options.env, ELECTRON_RUN_AS_NODE: "1" } : this.options.env,
        stdio: "pipe",
        windowsHide: true,
      });
    const child = new ManagedChild(childProcess, (code, signal) => {
      this.rejectPending(new RpcRequestError(BRIDGE_ERROR_CODES.notConnected, `omo exited with ${describeExit(code, signal)}`));
    });
    this.child = childLink(child);
    childProcess.stdout.on("data", (chunk: Buffer) => decoder.push(chunk));
    childProcess.stdout.on("end", () => decoder.end());
    void child.exited.then((info) => {
      for (const listener of [...this.exitListeners]) listener(info);
    });
  }

  /** Sends one command and resolves with its `data`; a refusal rejects with NativeCommandError. */
  send(command: string, fields: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const id = `ui-${this.nextId++}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcRequestError(BRIDGE_ERROR_CODES.timeout, `${command} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { command, resolve, reject, timer });
      try {
        this.write({ ...fields, id, type: command });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Writes a frame that expects no tracked answer (extension_ui_response). */
  write(frame: object): void {
    const child = this.child;
    if (!child || !child.writable) {
      throw new RpcRequestError(BRIDGE_ERROR_CODES.notConnected, "omo is not running");
    }
    child.write(`${JSON.stringify(frame)}\n`);
  }

  onRecord(listener: (record: NativeRecord) => void): () => void {
    return subscribe(this.recordListeners, listener);
  }

  onMalformed(listener: (line: string, error: Error) => void): () => void {
    return subscribe(this.malformedListeners, listener);
  }

  onExit(listener: (info: ExitInfo) => void): () => void {
    return subscribe(this.exitListeners, listener);
  }

  stop(timeouts: StopTimeouts): Promise<void> {
    return this.child?.stop(timeouts) ?? Promise.resolve();
  }

  private handle(value: unknown): void {
    if (!isRecord(value) || typeof value["type"] !== "string") {
      this.emitMalformed(JSON.stringify(value), new Error("record without a type"));
      return;
    }
    const record = value as NativeRecord;
    if (record.type === "response" && typeof record["id"] === "string") {
      const pending = this.pending.get(record["id"]);
      if (pending) {
        this.pending.delete(record["id"]);
        clearTimeout(pending.timer);
        if (record["success"] === true) pending.resolve(record["data"]);
        else {
          const errorCode = typeof record["errorCode"] === "string" ? record["errorCode"] : undefined;
          const message = typeof record["error"] === "string" ? record["error"] : `${pending.command} failed`;
          pending.reject(new NativeCommandError(pending.command, message, errorCode, record["errorData"]));
        }
        return;
      }
    }
    for (const listener of [...this.recordListeners]) listener(record);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private emitMalformed(line: string, error: Error): void {
    for (const listener of [...this.malformedListeners]) listener(line, error);
  }
}

function subscribe<T>(set: Set<T>, listener: T): () => void {
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}
