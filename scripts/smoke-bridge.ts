/**
 * Drives the real bridge modules (login-shell env, omo locator, app-server client) and the renderer
 * reducer end to end against an omo binary, without Electron. Usage:
 * `npm run smoke:bridge -- [--omo <path>] [--prompt <text>] [--timeout <ms>]`.
 * Exit codes: 0 pong-style turn succeeded, 1 turn or usage failure, 2 omo not found, 3 app-server start failed.
 */
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { AppServerClient, AppServerStartError } from "../electron/omo/app-server-client";
import type { ExitInfo } from "../electron/omo/app-server-client";
import { locateOmo } from "../electron/omo/locate";
import { resolveLoginShellEnv, scrubChildEnv } from "../electron/omo/shell-env";
import { ENV, OMO_INSTALL_COMMAND } from "../shared/ipc";
import type { OmoBinary } from "../shared/ipc";
import type { ThreadItem } from "../shared/protocol";
import { createInitialState, reduce } from "../src/state/reducer";
import type { AppEvent, AppState, ConversationTurn } from "../src/state/types";

const DEFAULT_PROMPT = "Reply with exactly: pong";
const DEFAULT_TIMEOUT_MS = 120_000;
const LOGIN_ENV_TIMEOUT_MS = 4_000;

interface SmokeArgs {
  omo: string | undefined;
  prompt: string;
  timeoutMs: number;
}

const resources: { client: AppServerClient | null; tempDir: string | null } = { client: null, tempDir: null };

function log(line: string): void {
  console.log(`[smoke] ${line}`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " \\n ");
}

function parseSmokeArgs(argv: string[]): SmokeArgs {
  const { values } = parseArgs({
    args: argv,
    options: { omo: { type: "string" }, prompt: { type: "string" }, timeout: { type: "string" } },
    strict: true,
  });
  const timeoutMs = values.timeout === undefined ? DEFAULT_TIMEOUT_MS : Number(values.timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error(`--timeout must be a positive number of ms, got ${values.timeout}`);
  return { omo: values.omo === undefined ? undefined : path.resolve(values.omo), prompt: values.prompt ?? DEFAULT_PROMPT, timeoutMs };
}

async function cleanup(): Promise<void> {
  await resources.client?.stop();
  const tempDir = resources.tempDir;
  resources.tempDir = null;
  if (tempDir !== null) await rm(tempDir, { recursive: true, force: true });
}

class ReducedStore {
  state: AppState = createInitialState();
  private readonly waiters = new Set<() => void>();

  dispatch(event: AppEvent): void {
    this.state = reduce(this.state, event);
    for (const waiter of [...this.waiters]) waiter();
  }

  turn(threadId: string, turnId: string): ConversationTurn | undefined {
    return this.state.conversations[threadId]?.turns.find((turn) => turn.id === turnId);
  }

  settled(target: { threadId: string; turnId: string; timeoutMs: number; exited: Promise<ExitInfo> }): Promise<ConversationTurn> {
    return new Promise((resolve, reject) => {
      const finish = (): void => {
        clearTimeout(timer);
        this.waiters.delete(check);
      };
      const check = (): void => {
        const turn = this.turn(target.threadId, target.turnId);
        if (turn !== undefined && turn.status !== "inProgress") {
          finish();
          resolve(turn);
        }
      };
      const timer = setTimeout(() => {
        finish();
        reject(new Error(`turn/completed not received within ${target.timeoutMs} ms`));
      }, target.timeoutMs);
      void target.exited.then((info) => {
        finish();
        reject(new Error(`omo exited during the turn (code=${info.code ?? "null"} signal=${info.signal ?? "none"})`));
      });
      this.waiters.add(check);
      check();
    });
  }
}

function summarizeItem(item: ThreadItem): string {
  switch (item.type) {
    case "agentMessage":
      return oneLine(item.text);
    case "reasoning":
      return oneLine([...item.summary, ...item.content].join(" ")).slice(0, 60);
    case "dynamicToolCall":
      return `${item.tool} success=${String(item.success)}`;
    case "userMessage":
      return oneLine(item.content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join(""));
    default:
      return "";
  }
}

function lastAgentText(turn: ConversationTurn): string {
  let text = "";
  for (const entry of turn.items) {
    if (entry.item.type === "agentMessage") text = entry.item.text;
  }
  return text;
}

async function locate(args: SmokeArgs): Promise<{ binary: OmoBinary; env: Record<string, string> } | null> {
  const login = await resolveLoginShellEnv({ baseEnv: process.env, homeDir: os.homedir(), timeoutMs: LOGIN_ENV_TIMEOUT_MS });
  log(`login-shell env: ${login.fromLoginShell ? "yes" : "no"}`);
  const located = await locateOmo({
    env: { ...login.env, [ENV.omoBin]: args.omo ?? process.env[ENV.omoBin] },
    homeDir: os.homedir(),
    loginPath: login.env["PATH"] ?? null,
  });
  if (located.ok) {
    const { path: binPath, version, source } = located.binary;
    log(`omo: ${binPath} ${version} (source=${source})`);
    return { binary: located.binary, env: login.env };
  }
  log("status: not-found");
  for (const entry of located.tried) log(`tried: ${entry.source} ${entry.path} - ${oneLine(entry.problem)}`);
  log(`install: ${OMO_INSTALL_COMMAND}`);
  return null;
}

function logStartFailure(error: unknown): void {
  const start = error instanceof AppServerStartError ? error : null;
  const code = start?.exitCode ?? null;
  const signal = start?.signal ?? null;
  log(`status: exited code=${code ?? "null"}${signal === null ? "" : ` signal=${signal}`}`);
  const lines = (start?.stderrTail ?? "").split("\n").map((line) => line.trim()).filter((line) => line !== "");
  log(`stderr: ${lines.length === 0 ? "(empty)" : lines.slice(-3).join(" | ")}`);
  if (code === null && signal === null) log(`error: ${oneLine(errorText(error))}`);
}

/** Deletes the recorded thread only after omo reports it in this run's own temporary workspace. */
async function deleteThread(client: AppServerClient, threadId: string, workspace: string): Promise<void> {
  try {
    const { thread } = await client.request("thread/read", { threadId });
    const cwd = await realpath(thread.cwd);
    if (cwd !== workspace) {
      log(`thread kept: its workspace ${cwd} is not ${workspace}`);
      return;
    }
    await client.request("thread/delete", { threadId });
    log("thread deleted");
  } catch (error) {
    log(`thread delete failed: ${oneLine(errorText(error))}`);
  }
}

async function runTurn(target: { client: AppServerClient; store: ReducedStore; threadId: string; exited: Promise<ExitInfo> }, args: SmokeArgs): Promise<boolean> {
  const { client, store, threadId, exited } = target;
  const started = await client.request("turn/start", {
    threadId,
    input: [{ type: "text", text: args.prompt, text_elements: [] }],
  });
  const turn = await store.settled({ threadId, turnId: started.turn.id, timeoutMs: args.timeoutMs, exited });
  log(`reduced turn status=${turn.status}`);
  for (const entry of turn.items) log(`item ${entry.item.type}: ${summarizeItem(entry.item)}`);
  return turn.status === "completed" && lastAgentText(turn) !== "";
}

async function run(args: SmokeArgs): Promise<number> {
  const found = await locate(args);
  if (found === null) return 2;
  const client = new AppServerClient({
    command: found.binary.path,
    args: ["app-server", "--listen", "stdio://"],
    cwd: os.homedir(),
    env: scrubChildEnv(found.env),
    clientVersion: "0.1.0",
  });
  resources.client = client;
  const exited = new Promise<ExitInfo>((resolve) => client.onExit(resolve));
  const store = new ReducedStore();
  client.onNotification((notification) => store.dispatch({ type: "rpc/notification", notification, receivedAtMs: Date.now() }));
  client.onServerRequest((request) => log(`server request ${request.method} (not answered by the smoke script)`));
  try {
    log(`connected: ${(await client.start()).userAgent}`);
  } catch (error) {
    logStartFailure(error);
    return 3;
  }
  const tempDir = await mkdtemp(`${os.tmpdir()}/omo-ui-smoke-`);
  resources.tempDir = tempDir;
  const workspace = await realpath(tempDir);
  const session = await client.request("thread/start", { cwd: tempDir });
  const threadId = session.thread.id;
  log(`thread: ${threadId}`);
  store.dispatch({ type: "thread/opened", thread: session.thread, resumed: false });
  let succeeded = false;
  try {
    succeeded = await runTurn({ client, store, threadId, exited }, args);
  } finally {
    await deleteThread(client, threadId, workspace);
  }
  await client.stop();
  const info = await exited;
  log(`child exited code=${info.code ?? "null"}${info.signal === null ? "" : ` signal=${info.signal}`}`);
  return succeeded ? 0 : 1;
}

async function main(): Promise<number> {
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
    process.once(signal, () => {
      void cleanup().finally(() => process.exit(code));
    });
  }
  try {
    return await run(parseSmokeArgs(process.argv.slice(2)));
  } catch (error) {
    log(`error: ${oneLine(errorText(error))}`);
    return 1;
  } finally {
    await cleanup();
  }
}

void main().then((code) => process.exit(code));
