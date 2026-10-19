import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ClientMethod,
  ClientParams,
  ClientResult,
  McpServerStatus,
  Model,
  ReasoningEffort,
  RequestId,
  RpcNotification,
  RpcServerRequest,
  SkillMetadata,
  Thread,
  ThreadAlertCode,
  ThreadSessionResult,
  ThreadStatus,
  Turn,
  UserInput,
  WireGoal,
} from "../../../shared/protocol";
import { ORIGIN_CONTEXT } from "../../../shared/session-origin";
import { keysetPage } from "../../history/session-catalog";
import { parseSessionJsonl } from "../../history/session-jsonl";
import type { AppServerClientOptions, InitializeResult } from "../app-server-client";
import type { ExitInfo, StopTimeouts } from "../managed-child";
import { AppServerStartError, BRIDGE_ERROR_CODES, RpcRequestError } from "../rpc";
import { NativeCommandError, NativeConnection } from "./connection";
import type { NativeRecord } from "./connection";
import { TurnProjector } from "./projector";
import { SessionIndex } from "./threads";
import type { SessionRecord } from "./threads";
import { UiBridge } from "./ui-bridge";

type JsonObject = Record<string, unknown>;

interface Loaded {
  threadId: string;
  handle: string;
  sessionPath: string | null;
  cwd: string;
  createdAtMs: number;
  projector: TurnProjector;
  holding: NativeRecord[] | null;
  goal: string | null;
  /** Ids of custom_message entries already shown live, so one entry never produces two notices. */
  noticeIds: Set<string>;
  /** `extensionPath\0event` pairs already reported, so a failing extension warns once. */
  extensionErrors: Set<string>;
}

const DEFAULT_STOP_TIMEOUTS: StopTimeouts = { afterStdinEnd: 2_000, afterSigterm: 3_000 };
// Prompt acknowledgement can wait for a compaction (rpc.md "RPC client lifecycle": at most 46 minutes).
const PROMPT_TIMEOUT_MS = 46 * 60 * 1000;
const DEFAULT_THREAD_LIST_LIMIT = 25;
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function params(value: unknown): JsonObject {
  return isRecord(value) ? value : {};
}

function requiredString(value: JsonObject, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field === "") throw new RpcRequestError(-32602, `Invalid params: ${key} must be a non-empty string`);
  return field;
}

function threadNotFound(threadId: string): RpcRequestError {
  return new RpcRequestError(-32600, `thread not found: ${threadId}`);
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function splitModel(model: string): { provider: string; modelId: string } | null {
  const separator = model.indexOf("/");
  return separator <= 0 || separator >= model.length - 1 ? null : { provider: model.slice(0, separator), modelId: model.slice(separator + 1) };
}

function wireModel(model: JsonObject, defaultModel: { provider: string; id: string } | null): Model | null {
  const id = typeof model["id"] === "string" ? model["id"] : null;
  const provider = typeof model["provider"] === "string" ? model["provider"] : null;
  if (id === null || provider === null) return null;
  const levels = Array.isArray(model["supportedThinkingLevels"]) ? model["supportedThinkingLevels"].filter((level): level is ReasoningEffort => typeof level === "string" && level !== "off") : [];
  const fallback = typeof model["defaultThinkingLevel"] === "string" && model["defaultThinkingLevel"] !== "off" ? model["defaultThinkingLevel"] as ReasoningEffort : "medium";
  return {
    id: `${provider}/${id}`,
    model: id,
    displayName: typeof model["name"] === "string" ? model["name"] : id,
    description: "",
    hidden: model["hidden"] === true,
    supportedReasoningEfforts: model["reasoning"] === true ? levels.map((reasoningEffort) => ({ reasoningEffort, description: "" })) : [],
    defaultReasoningEffort: fallback,
    isDefault: defaultModel?.provider === provider && defaultModel.id === id,
  };
}

function skillScope(scope: unknown): SkillMetadata["scope"] {
  return scope === "user" ? "user" : scope === "project" ? "repo" : "system";
}

function wireGoal(threadId: string, stored: unknown): WireGoal | null {
  const goal = isRecord(stored) ? stored["goal"] : undefined;
  if (!isRecord(goal) || typeof goal["objective"] !== "string") return null;
  const status = goal["status"] === "paused" || goal["status"] === "blocked" || goal["status"] === "complete" ? goal["status"] : "active";
  const number = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  return {
    threadId,
    objective: goal["objective"],
    status,
    tokenBudget: typeof goal["tokenBudget"] === "number" ? goal["tokenBudget"] : null,
    tokensUsed: number(goal["tokensUsed"]),
    timeUsedSeconds: number(goal["timeUsedSeconds"]),
    createdAt: number(goal["createdAt"]),
    updatedAt: number(goal["updatedAt"]),
  };
}

/**
 * Serves the app-server methods OmO UI calls from one `omo --mode rpc --multi-session` host. omo 5.1.34
 * removed `omo app-server`; this keeps the renderer, the phone bridges and their protocol unchanged.
 */
export class NativeAppServerClient {
  private readonly connection: NativeConnection;
  private readonly index: SessionIndex;
  private readonly agentDir: string;
  private readonly stateDir: string;
  private readonly sessions = new Map<string, Loaded>();
  private readonly byHandle = new Map<string, Loaded>();
  private readonly opening = new Map<string, Promise<Loaded>>();
  private readonly utility = new Map<string, Promise<{ handle: string; model: { provider: string; id: string } | null }>>();
  private readonly utilityHandles = new Set<string>();
  private readonly ui: UiBridge;
  private initResult: InitializeResult | null = null;
  private readonly notificationListeners = new Set<(notification: RpcNotification) => void>();
  private readonly serverRequestListeners = new Set<(request: RpcServerRequest) => void>();
  private readonly malformedListeners = new Set<(line: string, error: Error) => void>();
  private readonly exitListeners = new Set<(info: ExitInfo) => void>();

  constructor(private readonly options: AppServerClientOptions) {
    this.agentDir = options.agentDir ?? path.join(options.cwd, ".omo", "agent");
    this.stateDir = options.stateDir ?? path.join(os.tmpdir(), "omo-ui-native");
    this.index = new SessionIndex(path.join(this.agentDir, "sessions"));
    this.connection = new NativeConnection({
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      env: options.env,
      ...(options.spawnImpl === undefined ? {} : { spawnImpl: options.spawnImpl }),
      ...(options.socket === undefined ? {} : { socket: options.socket }),
    });
    this.ui = new UiBridge(
      (handle, frame) => this.connection.write({ ...frame, type: "extension_ui_response", sessionId: handle }),
      (request) => this.emitRequest(request),
      (notification) => this.emit(notification),
    );
    this.connection.onRecord((record) => this.route(record));
    this.connection.onMalformed((line, error) => {
      for (const listener of [...this.malformedListeners]) listener(line, error);
    });
    this.connection.onExit((info) => {
      for (const loaded of this.sessions.values()) loaded.projector.abandon();
      for (const listener of [...this.exitListeners]) listener(info);
    });
  }

  get pid(): number | null {
    return this.connection.pid;
  }

  get initializeResult(): InitializeResult | null {
    return this.initResult;
  }

  async start(): Promise<InitializeResult> {
    this.connection.start();
    const startTimeoutMs = this.options.startTimeoutMs ?? 30_000;
    try {
      const info = params(await this.connection.send("get_protocol_info", {}, startTimeoutMs));
      if (info["mode"] !== "multi") throw new Error(`omo answered in ${String(info["mode"])} mode, not multi-session`);
      try {
        await this.connection.send("set_client_info", { width: 120, capabilities: ["extension_events", "question", "media_placeholders"] }, startTimeoutMs);
      } catch (error) {
        if (!(error instanceof NativeCommandError)) throw error;
      }
      const version = typeof info["serverVersion"] === "string" ? info["serverVersion"] : "unknown";
      this.initResult = {
        userAgent: `omo/${version}`,
        codexHome: this.agentDir,
        platformFamily: process.platform === "win32" ? "windows" : "unix",
        platformOs: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux",
      };
      return this.initResult;
    } catch (error) {
      const exited = this.connection.exited;
      if (this.connection.hasExited && exited !== null) {
        const info = await exited;
        const spawnError = this.connection.spawnError;
        const reason = spawnError ? `failed to spawn (${spawnError.message})` : `exited with code ${String(info.code ?? info.signal)}`;
        const tail = info.stderrTail.trim();
        throw new AppServerStartError(`omo ${reason} before initializing${tail ? `: ${tail}` : ""}`, info.code, info.signal, info.stderrTail);
      }
      const stderrTail = this.connection.stderrTail;
      await this.stop();
      if (error instanceof RpcRequestError && error.code === BRIDGE_ERROR_CODES.timeout) {
        throw new AppServerStartError(`omo did not answer get_protocol_info within ${startTimeoutMs} ms`, null, null, stderrTail);
      }
      throw new AppServerStartError(`omo initialize failed: ${error instanceof Error ? error.message : String(error)}`, null, null, stderrTail);
    }
  }

  stop(): Promise<void> {
    return this.connection.stop(this.options.stopTimeoutsMs ?? DEFAULT_STOP_TIMEOUTS);
  }

  respond(id: RequestId, result: unknown): void {
    this.ui.respond(id, result);
  }

  onNotification(listener: (notification: RpcNotification) => void): () => void {
    return subscribe(this.notificationListeners, listener);
  }

  onServerRequest(listener: (request: RpcServerRequest) => void): () => void {
    return subscribe(this.serverRequestListeners, listener);
  }

  onMalformed(listener: (line: string, error: Error) => void): () => void {
    return subscribe(this.malformedListeners, listener);
  }

  onExit(listener: (info: ExitInfo) => void): () => void {
    return subscribe(this.exitListeners, listener);
  }

  request<M extends ClientMethod>(method: M, input: ClientParams<M>): Promise<ClientResult<M>> {
    return this.dispatch(method, params(input)).then((result) => result as ClientResult<M>);
  }

  private async dispatch(method: ClientMethod, input: JsonObject): Promise<unknown> {
    switch (method) {
      case "initialize":
        if (this.initResult === null) throw new RpcRequestError(BRIDGE_ERROR_CODES.notConnected, "omo is not initialized");
        return this.initResult;
      case "thread/list":
        return this.listThreads(input);
      case "thread/loaded/list":
        return { data: [...this.sessions.keys()], nextCursor: null };
      case "thread/start":
        return this.startThread(input);
      case "thread/resume":
        return this.resumeThread(requiredString(input, "threadId"));
      case "thread/read":
        return this.readThread(requiredString(input, "threadId"), input["includeTurns"] === true);
      case "thread/fork":
        return this.forkThread(requiredString(input, "threadId"), typeof input["cwd"] === "string" ? input["cwd"] : null);
      case "thread/name/set":
        return this.setName(requiredString(input, "threadId"), requiredString(input, "name"));
      case "thread/settings/update":
        return this.updateSettings(requiredString(input, "threadId"), input);
      case "thread/archive":
        return this.archive(requiredString(input, "threadId"));
      case "thread/unarchive":
        return this.unarchive(requiredString(input, "threadId"));
      case "thread/delete":
        return this.deleteThread(requiredString(input, "threadId"));
      case "thread/compact/start":
        return this.compact(requiredString(input, "threadId"));
      case "thread/goal/get":
        return { goal: await this.readGoal(requiredString(input, "threadId")) };
      case "thread/goal/set":
        return this.setGoal(requiredString(input, "threadId"), input);
      case "thread/goal/clear":
        return this.clearGoal(requiredString(input, "threadId"));
      case "turn/start":
        return this.startTurn(requiredString(input, "threadId"), input);
      case "turn/steer":
        return this.steer(requiredString(input, "threadId"), input);
      case "turn/interrupt":
        return this.interrupt(requiredString(input, "threadId"), requiredString(input, "turnId"));
      case "model/list":
        return this.listModels();
      case "skills/list":
        return this.listSkills(input);
      case "account/providerAccounts/read": {
        const provider = requiredString(input, "provider");
        const data = params(await this.utilityCommand(this.options.cwd, "get_provider_accounts", { provider }));
        return { provider, accounts: Array.isArray(data["accounts"]) ? data["accounts"] : [] };
      }
      case "account/providerAccounts/pin":
        await this.utilityCommand(this.options.cwd, "account_pin", { provider: requiredString(input, "provider"), name: input["name"] ?? null });
        return {};
      case "account/providerAccounts/remove":
        await this.utilityCommand(this.options.cwd, "account_remove", { provider: requiredString(input, "provider"), name: requiredString(input, "name") });
        return {};
      case "mcpServerStatus/list":
        return this.listMcp(typeof input["threadId"] === "string" ? input["threadId"] : null);
      case "extension_request": {
        const loaded = await this.load(requiredString(input, "threadId"));
        return this.command(loaded.handle, "extension_request", { name: requiredString(input, "name"), ...(input["data"] === undefined ? {} : { data: input["data"] }) });
      }
      default:
        throw new RpcRequestError(-32601, `method not supported by the native omo bridge: ${String(method)}`);
    }
  }

  private command(handle: string, command: string, fields: JsonObject = {}, timeoutMs = this.options.requestTimeoutMs ?? 60_000): Promise<unknown> {
    return this.connection.send(command, { ...fields, sessionId: handle }, timeoutMs);
  }

  private emit(notification: RpcNotification): void {
    for (const listener of [...this.notificationListeners]) listener(notification);
  }

  private emitRequest(request: RpcServerRequest): void {
    for (const listener of [...this.serverRequestListeners]) listener(request);
  }

  private route(record: NativeRecord): void {
    const handle = record["sessionId"];
    if (typeof handle !== "string") return;
    if (this.utilityHandles.has(handle)) {
      if (record.type === "extension_ui_request" && ["select", "confirm", "input", "editor", "question"].includes(String(record["method"]))) {
        this.connection.write({ type: "extension_ui_response", sessionId: handle, id: record["id"], cancelled: true });
      }
      return;
    }
    const loaded = this.byHandle.get(handle);
    if (loaded === undefined) return;
    if (loaded.holding !== null) {
      loaded.holding.push(record);
      return;
    }
    this.apply(loaded, record);
  }

  private apply(loaded: Loaded, record: NativeRecord): void {
    switch (record.type) {
      case "extension_ui_request":
        this.ui.handle({
          threadId: loaded.threadId, handle: loaded.handle, cwd: loaded.cwd, activeTurnId: loaded.projector.activeTurnId,
          filePaths: (toolCallId) => loaded.projector.filePathsOf(toolCallId),
        }, record);
        return;
      case "question_resolved":
        this.ui.resolved(record);
        return;
      case "extension_event":
        this.emit({ method: "extension_event", params: { type: "extension_event", threadId: loaded.threadId, name: record["name"], data: record["data"] } });
        return;
      case "entry_appended": {
        const entry = record["entry"];
        if (isRecord(entry) && entry["type"] === "session_info") {
          const name = typeof entry["name"] === "string" && entry["name"].trim() !== "" ? entry["name"] : undefined;
          this.emit({ method: "thread/name/updated", params: name === undefined ? { threadId: loaded.threadId } : { threadId: loaded.threadId, threadName: name } });
        }
        if (isRecord(entry) && entry["type"] === "custom_message") this.showCustomMessage(loaded, entry);
        return;
      }
      case "model_changed": {
        const model = isRecord(record["model"]) ? record["model"] : {};
        if (typeof model["provider"] !== "string" || typeof model["id"] !== "string") return;
        const id = `${model["provider"]}/${model["id"]}`;
        const level = record["thinkingLevel"];
        const source = typeof record["source"] === "string" ? record["source"] : "set";
        this.emit({
          method: "thread/settings/changed",
          params: { threadId: loaded.threadId, model: id, effort: typeof level === "string" ? (level === "off" ? "none" : level) : null, source },
        });
        if (source === "fallback") this.alert(loaded, `fallback:${id}`, "info", "modelFallback", { model: id });
        return;
      }
      case "transcript_write_failed":
        this.alert(loaded, `transcript:${Date.now()}`, "error", "transcriptWriteFailed", { error: typeof record["errorMessage"] === "string" ? record["errorMessage"] : "unknown error" }, true);
        return;
      case "extension_error": {
        const extension = typeof record["extensionPath"] === "string" ? record["extensionPath"] : "unknown";
        const event = typeof record["event"] === "string" ? record["event"] : "unknown";
        const key = `${extension}\u0000${event}`;
        if (loaded.extensionErrors.has(key)) return;
        loaded.extensionErrors.add(key);
        this.alert(loaded, `extension:${key}`, "warning", "extensionError", { extension, event, error: typeof record["error"] === "string" ? record["error"] : "unknown error" });
        return;
      }
      case "commands_changed":
      case "loaded_surfaces_changed":
        this.emit({ method: "skills/changed", params: {} });
        return;
      case "agent_end":
        loaded.projector.handle(record);
        void this.refreshGoal(loaded);
        return;
      case "agent_settled":
        loaded.projector.handle(record);
        void this.refreshGoal(loaded);
        this.emit({ method: "mcpServer/startupStatus/updated", params: { threadId: loaded.threadId } });
        return;
      case "tool_execution_end":
        loaded.projector.handle(record);
        void this.refreshGoal(loaded);
        return;
      case "session_closed":
      case "session_parked":
        this.forget(loaded);
        this.emit({ method: "thread/status/changed", params: { threadId: loaded.threadId, status: { type: "notLoaded" } } });
        return;
      default:
        loaded.projector.handle(record);
    }
  }

  private alert(loaded: Loaded, key: string, level: "info" | "warning" | "error", code: ThreadAlertCode, params: Record<string, string>, pinned = false): void {
    this.emit({ method: "thread/alert", params: { threadId: loaded.threadId, key, level, code, params, pinned } });
  }

  private showCustomMessage(loaded: Loaded, entry: JsonObject): void {
    const id = entry["id"];
    const customType = entry["customType"];
    if (typeof id !== "string" || typeof customType !== "string" || entry["display"] === false || loaded.noticeIds.has(id)) return;
    loaded.noticeIds.add(id);
    const content = entry["content"];
    const text = typeof content === "string" ? content : Array.isArray(content)
      ? content.map((block) => (isRecord(block) && block["type"] === "text" && typeof block["text"] === "string" ? block["text"] : "")).filter((part) => part !== "").join("\n") : "";
    const at = typeof entry["timestamp"] === "string" ? Date.parse(entry["timestamp"]) : typeof entry["timestamp"] === "number" ? entry["timestamp"] : Number.NaN;
    this.emit({ method: "thread/notice/added", params: { threadId: loaded.threadId, notice: { id, customType, display: true, text, timestamp: Number.isFinite(at) ? at : null } } });
  }

  private release(loaded: Loaded): void {
    const held = loaded.holding ?? [];
    loaded.holding = null;
    for (const record of held) this.apply(loaded, record);
  }

  private forget(loaded: Loaded): void {
    loaded.projector.abandon();
    this.ui.dropSession(loaded.handle);
    this.sessions.delete(loaded.threadId);
    this.byHandle.delete(loaded.handle);
  }

  private register(handle: string, state: JsonObject, fallbackCwd: string): Loaded {
    const threadId = typeof state["sessionId"] === "string" ? state["sessionId"] : handle;
    const existing = this.sessions.get(threadId);
    if (existing !== undefined && existing.handle === handle) return existing;
    const cwd = typeof state["cwd"] === "string" ? state["cwd"] : fallbackCwd;
    const loaded: Loaded = {
      threadId,
      handle,
      sessionPath: typeof state["sessionFile"] === "string" ? state["sessionFile"] : null,
      cwd,
      createdAtMs: Date.now(),
      projector: new TurnProjector(threadId, cwd, (notification) => this.emit(notification)),
      holding: null,
      goal: null,
      noticeIds: new Set(),
      extensionErrors: new Set(),
    };
    this.sessions.set(threadId, loaded);
    this.byHandle.set(handle, loaded);
    return loaded;
  }

  private async openSession(fields: JsonObject, fallbackCwd: string): Promise<Loaded> {
    const data = params(await this.connection.send("open_session", { promptSurface: "app", ...fields }, this.options.startTimeoutMs ?? 60_000));
    const handle = data["sessionId"];
    if (typeof handle !== "string") throw new Error("omo open_session returned no session handle");
    const loaded = this.register(handle, params(data["state"]), fallbackCwd);
    this.emit({ method: "mcpServer/startupStatus/updated", params: { threadId: loaded.threadId } });
    return loaded;
  }

  private load(threadId: string): Promise<Loaded> {
    const loaded = this.sessions.get(threadId);
    if (loaded !== undefined) return Promise.resolve(loaded);
    let pending = this.opening.get(threadId);
    if (pending === undefined) {
      pending = (async () => {
        const record = await this.index.find(threadId);
        if (record === null) throw threadNotFound(threadId);
        return this.openSession({ sessionPath: record.sessionPath, ...(record.cwd ? { cwd: record.cwd } : {}) }, record.cwd);
      })().finally(() => this.opening.delete(threadId));
      this.opening.set(threadId, pending);
    }
    return pending;
  }

  private status(threadId: string): ThreadStatus {
    const loaded = this.sessions.get(threadId);
    if (loaded === undefined) return { type: "notLoaded" };
    return loaded.projector.activeTurnId === null ? { type: "idle" } : { type: "active", activeFlags: [] };
  }

  private loadedThread(loaded: Loaded): Thread {
    const record: Omit<SessionRecord, "facts"> = {
      id: loaded.threadId, sessionPath: loaded.sessionPath ?? "", cwd: loaded.cwd, createdAtMs: loaded.createdAtMs,
      updatedAtMs: loaded.createdAtMs, name: null, preview: null, parentSession: null,
    };
    return { ...this.index.toThread(record, this.status(loaded.threadId)), path: loaded.sessionPath };
  }

  private async thread(threadId: string): Promise<Thread> {
    const record = await this.index.find(threadId);
    if (record !== null) return this.index.toThread(record, this.status(threadId));
    const loaded = this.sessions.get(threadId);
    if (loaded !== undefined) return this.loadedThread(loaded);
    throw threadNotFound(threadId);
  }

  private async sessionResult(loaded: Loaded, thread: Thread): Promise<ThreadSessionResult> {
    const state = params(await this.command(loaded.handle, "get_state"));
    const model = params(state["model"]);
    return {
      thread,
      model: typeof model["id"] === "string" ? model["id"] : "unknown",
      modelProvider: typeof model["provider"] === "string" ? model["provider"] : "unknown",
      cwd: loaded.cwd,
      reasoningEffort: typeof state["thinkingLevel"] === "string" ? state["thinkingLevel"] as ReasoningEffort : null,
    };
  }

  private async listThreads(input: JsonObject): Promise<{ data: Thread[]; nextCursor: string | null }> {
    const archived = input["archived"] === true;
    const cwdFilter = typeof input["cwd"] === "string" ? [input["cwd"]] : Array.isArray(input["cwd"]) ? input["cwd"].filter((cwd): cwd is string => typeof cwd === "string") : null;
    const term = typeof input["searchTerm"] === "string" ? input["searchTerm"].trim().toLocaleLowerCase() : "";
    const matches: SessionRecord[] = [];
    for (const record of await this.index.list()) {
      if (await this.index.isArchived(record) !== archived) continue;
      if (cwdFilter !== null && !cwdFilter.some((cwd) => samePath(cwd, record.cwd))) continue;
      if (term !== "" && !`${record.name ?? ""}\n${record.preview ?? ""}`.toLocaleLowerCase().includes(term)) continue;
      matches.push(record);
    }
    const limit = typeof input["limit"] === "number" && input["limit"] > 0 ? input["limit"] : DEFAULT_THREAD_LIST_LIMIT;
    const { page, nextCursor } = keysetPage(matches, input["cursor"], limit, Date.now());
    return { data: page.map((record) => this.index.toThread(record, this.status(record.id))), nextCursor };
  }

  private async startThread(input: JsonObject): Promise<ThreadSessionResult> {
    const cwd = requiredString(input, "cwd");
    const model = typeof input["model"] === "string" ? splitModel(input["model"]) : null;
    const loaded = await this.openSession({ cwd, ...(model === null ? {} : model), kind: "interactive", context: ORIGIN_CONTEXT }, cwd);
    const thread = this.loadedThread(loaded);
    this.emit({ method: "thread/started", params: { thread } });
    return this.sessionResult(loaded, thread);
  }

  private async resumeThread(threadId: string): Promise<ThreadSessionResult> {
    const loaded = await this.load(threadId);
    const thread = await this.thread(threadId);
    this.emit({ method: "thread/status/changed", params: { threadId, status: thread.status } });
    return this.sessionResult(loaded, thread);
  }

  private async readThread(threadId: string, includeTurns: boolean): Promise<{ thread: Thread }> {
    const thread = await this.thread(threadId);
    if (!includeTurns || thread.path === null || thread.path === "" || !existsSync(thread.path)) return { thread };
    const history = parseSessionJsonl(await readFile(thread.path, "utf8"));
    const turns: Turn[] = history.turns.map((turn) => ({
      id: turn.id, items: turn.items, itemsView: "full", status: turn.status, error: turn.error,
      startedAt: turn.startedAt === null ? null : turn.startedAt / 1000, completedAt: turn.completedAt === null ? null : turn.completedAt / 1000,
    }));
    return { thread: { ...thread, turns } };
  }

  private async forkThread(threadId: string, cwd: string | null): Promise<ThreadSessionResult> {
    const record = await this.index.find(threadId);
    if (record === null) throw threadNotFound(threadId);
    const target = await this.index.fork(record, cwd ?? record.cwd);
    const loaded = await this.openSession({ sessionPath: target, cwd: cwd ?? record.cwd }, cwd ?? record.cwd);
    // The removed app-server titled a fork "<source> (fork)" so the two rows stay apart in the sidebar.
    const name = record.name === null ? null : `${record.name} (fork)`;
    if (name !== null) await this.command(loaded.handle, "set_session_name", { name });
    const thread = { ...await this.thread(loaded.threadId), ...(name === null ? {} : { name }), forkedFromId: threadId };
    this.emit({ method: "thread/started", params: { thread } });
    return this.sessionResult(loaded, thread);
  }

  private async setName(threadId: string, name: string): Promise<Record<string, never>> {
    const loaded = await this.load(threadId);
    await this.command(loaded.handle, "set_session_name", { name });
    this.emit({ method: "thread/name/updated", params: { threadId, threadName: name } });
    return {};
  }

  private async updateSettings(threadId: string, input: JsonObject): Promise<Record<string, never>> {
    const loaded = await this.load(threadId);
    if (typeof input["model"] === "string") {
      const model = splitModel(input["model"]);
      if (model === null) throw new RpcRequestError(-32602, `Invalid params: model must be provider/id, got ${input["model"]}`);
      await this.command(loaded.handle, "set_model", model);
    }
    if (typeof input["effort"] === "string") {
      await this.command(loaded.handle, "set_thinking_level", { level: input["effort"] === "none" ? "off" : input["effort"] });
    }
    return {};
  }

  private async closeIfLoaded(threadId: string): Promise<void> {
    const loaded = this.sessions.get(threadId);
    if (loaded === undefined) return;
    try {
      await this.command(loaded.handle, "close_session");
    } finally {
      this.forget(loaded);
    }
  }

  private async archive(threadId: string): Promise<Record<string, never>> {
    const record = await this.index.find(threadId);
    if (record === null) throw threadNotFound(threadId);
    await this.closeIfLoaded(threadId);
    await this.index.archive(record);
    this.emit({ method: "thread/status/changed", params: { threadId, status: { type: "notLoaded" } } });
    this.emit({ method: "thread/archived", params: { threadId } });
    return {};
  }

  private async unarchive(threadId: string): Promise<{ status: ThreadStatus }> {
    const record = await this.index.find(threadId);
    if (record === null || !(await this.index.isArchived(record))) throw threadNotFound(threadId);
    await this.index.unarchive(record);
    this.emit({ method: "thread/unarchived", params: { threadId } });
    return { status: { type: "notLoaded" } };
  }

  private async deleteThread(threadId: string): Promise<Record<string, never>> {
    const record = await this.index.find(threadId);
    const loaded = this.sessions.get(threadId);
    if (record === null && loaded === undefined) throw threadNotFound(threadId);
    await this.closeIfLoaded(threadId);
    if (record !== null) await this.index.remove(record);
    this.emit({ method: "thread/status/changed", params: { threadId, status: { type: "notLoaded" } } });
    this.emit({ method: "thread/deleted", params: { threadId } });
    return {};
  }

  private async compact(threadId: string): Promise<Record<string, never>> {
    const loaded = await this.load(threadId);
    this.command(loaded.handle, "compact", {}, PROMPT_TIMEOUT_MS).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[omo-ui] compaction of ${threadId} failed: ${message}`);
      this.alert(loaded, `compact:${Date.now()}`, "error", "compactFailed", { error: message });
    });
    return {};
  }

  private async goalFile(threadId: string): Promise<string | null> {
    const loaded = this.sessions.get(threadId);
    const sessionPath = loaded?.sessionPath ?? (await this.index.find(threadId))?.sessionPath ?? null;
    return sessionPath === null ? null : path.join(path.dirname(sessionPath), "extensions", "goal", `${threadId}.json`);
  }

  private async readGoal(threadId: string): Promise<WireGoal | null> {
    const file = await this.goalFile(threadId);
    if (file === null) throw threadNotFound(threadId);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
    try {
      return wireGoal(threadId, JSON.parse(text));
    } catch (error) {
      if (error instanceof SyntaxError) return null; // omo rewrites the store atomically; a torn read retries next time.
      throw error;
    }
  }

  private async refreshGoal(loaded: Loaded): Promise<void> {
    try {
      const goal = await this.readGoal(loaded.threadId);
      const key = goal === null ? null : JSON.stringify(goal);
      if (key === loaded.goal) return;
      const hadGoal = loaded.goal !== null;
      loaded.goal = key;
      if (goal !== null) this.emit({ method: "thread/goal/updated", params: { threadId: loaded.threadId, turnId: null, goal } });
      else if (hadGoal) this.emit({ method: "thread/goal/cleared", params: { threadId: loaded.threadId } });
    } catch (error) {
      console.warn(`[omo-ui] could not read the goal of ${loaded.threadId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async goalCommand(loaded: Loaded, args: string): Promise<void> {
    await this.command(loaded.handle, "prompt", { message: `/goal ${args}` }, PROMPT_TIMEOUT_MS);
  }

  private async setGoal(threadId: string, input: JsonObject): Promise<{ goal: WireGoal }> {
    const status = input["status"];
    if (status === "complete") throw new RpcRequestError(-32600, "unsupported goal status: complete");
    if (status !== undefined && status !== null && status !== "active" && status !== "paused") {
      throw new RpcRequestError(-32602, "Invalid params: status must be active or paused");
    }
    const loaded = await this.load(threadId);
    const objective = typeof input["objective"] === "string" ? input["objective"].trim() : "";
    if (objective !== "") {
      if (["pause", "resume", "clear"].includes(objective.toLowerCase())) throw new RpcRequestError(-32602, `Invalid params: "${objective}" is a /goal command, not an objective`);
      this.ui.expectGoalReplace(loaded.handle);
      try {
        await this.goalCommand(loaded, objective);
      } finally {
        this.ui.clearGoalReplace(loaded.handle);
      }
    } else if (await this.readGoal(threadId) === null) {
      throw new RpcRequestError(-32600, `objective is required for new goal: ${threadId}`);
    }
    if (status === "paused") await this.goalCommand(loaded, "pause");
    else if (status === "active") await this.goalCommand(loaded, "resume");
    const goal = await this.readGoal(threadId);
    if (goal === null) throw new RpcRequestError(-32603, `omo did not store the goal of ${threadId}`);
    loaded.goal = JSON.stringify(goal);
    this.emit({ method: "thread/goal/updated", params: { threadId, turnId: loaded.projector.activeTurnId, goal } });
    return { goal };
  }

  private async clearGoal(threadId: string): Promise<Record<string, never>> {
    const loaded = await this.load(threadId);
    const existed = await this.readGoal(threadId) !== null;
    await this.goalCommand(loaded, "clear");
    loaded.goal = null;
    if (existed) this.emit({ method: "thread/goal/cleared", params: { threadId } });
    return {};
  }

  private async promptContent(input: unknown): Promise<{ message: string; images: JsonObject[]; shown: UserInput[] }> {
    const items = Array.isArray(input) ? input.filter(isRecord) : [];
    const texts: string[] = [];
    const images: JsonObject[] = [];
    const shown: UserInput[] = [];
    for (const item of items) {
      if (item["type"] === "text" && typeof item["text"] === "string") {
        texts.push(item["text"]);
        shown.push({ type: "text", text: item["text"], text_elements: [] });
      } else if (item["type"] === "image" && typeof item["url"] === "string") {
        const match = /^data:([^;,]+);base64,(.*)$/s.exec(item["url"]);
        if (match === null) throw new RpcRequestError(-32602, "Invalid params: image input must be a base64 data URL");
        images.push({ type: "image", mimeType: match[1], data: match[2] });
        shown.push({ type: "image", url: item["url"] });
      } else if (item["type"] === "localImage" && typeof item["path"] === "string") {
        const mimeType = IMAGE_TYPES[path.extname(item["path"]).toLowerCase()];
        if (mimeType === undefined) throw new RpcRequestError(-32602, `Invalid params: unsupported image type ${item["path"]}`);
        const data = (await readFile(item["path"])).toString("base64");
        images.push({ type: "image", mimeType, data });
        shown.push({ type: "image", url: `data:${mimeType};base64,${data}` });
      } else {
        throw new RpcRequestError(-32602, `Invalid params: unsupported input item type ${String(item["type"])}`);
      }
    }
    const message = texts.join("\n");
    if (message.trim() === "" && images.length === 0) throw new RpcRequestError(-32602, "Invalid params: text input is required");
    return { message, images, shown };
  }

  private async startTurn(threadId: string, input: JsonObject): Promise<{ turn: Turn }> {
    const loaded = await this.load(threadId);
    const { message, images, shown } = await this.promptContent(input["input"]);
    if (loaded.projector.activeTurnId !== null && await this.closeStaleTurn(loaded)) {
      throw new RpcRequestError(-32600, `thread ${threadId} already has a running turn`);
    }
    const clientId = typeof input["clientUserMessageId"] === "string" && input["clientUserMessageId"] !== "" ? input["clientUserMessageId"] : null;
    loaded.holding = [];
    let disposition: unknown;
    try {
      const data = params(await this.command(loaded.handle, "prompt", {
        message, ...(images.length > 0 ? { images } : {}), ...(clientId === null ? {} : { clientMessageId: clientId }),
      }, PROMPT_TIMEOUT_MS));
      disposition = data["disposition"];
    } catch (error) {
      this.release(loaded);
      throw error;
    }
    const turn = loaded.projector.beginClientTurn(shown, clientId);
    if (disposition === "handled") loaded.projector.completeNow();
    this.release(loaded);
    return { turn };
  }

  private async steer(threadId: string, input: JsonObject): Promise<{ turnId: string }> {
    const loaded = await this.load(threadId);
    const active = loaded.projector.activeTurnId;
    if (active === null) throw new RpcRequestError(-32600, `No active turn for thread ${threadId}`);
    if (typeof input["expectedTurnId"] === "string" && input["expectedTurnId"] !== active) {
      throw new RpcRequestError(-32600, `Turn id mismatch: expected ${input["expectedTurnId"]} but active turn is ${active}`);
    }
    const { message, images, shown } = await this.promptContent(input["input"]);
    try {
      await this.command(loaded.handle, "steer", { message, ...(images.length > 0 ? { images } : {}) }, PROMPT_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof NativeCommandError) await this.closeStaleTurn(loaded);
      throw error;
    }
    loaded.projector.showSteer(shown);
    return { turnId: active };
  }

  /**
   * The projected turn outlived omo's run when its end events were lost: ends it once omo reports the session idle.
   * Resolves true when the session really is still running.
   */
  private async closeStaleTurn(loaded: Loaded): Promise<boolean> {
    const state = params(await this.command(loaded.handle, "get_state"));
    if (state["isStreaming"] === true) return true;
    loaded.projector.completeNow();
    return false;
  }

  private async interrupt(threadId: string, turnId: string): Promise<Record<string, never>> {
    const loaded = this.sessions.get(threadId);
    const active = loaded?.projector.activeTurnId ?? null;
    if (loaded === undefined || active === null) return {};
    if (active !== turnId) throw new RpcRequestError(-32600, `Turn id mismatch: expected ${turnId} but active turn is ${active}`);
    loaded.projector.markInterrupted();
    // A pending auto-retry is cancelled first; abort alone would let omo schedule the next attempt.
    if (loaded.projector.retryPending) await this.command(loaded.handle, "abort_retry");
    await this.command(loaded.handle, "abort");
    // An aborted run closes its permission dialogs without a record, so their cards are withdrawn here.
    this.ui.dropSession(loaded.handle);
    if (loaded.projector.activeTurnId === turnId) loaded.projector.completeNow("interrupted");
    return {};
  }

  private utilitySession(cwd: string): Promise<{ handle: string; model: { provider: string; id: string } | null }> {
    const key = process.platform === "win32" ? path.resolve(cwd).toLowerCase() : path.resolve(cwd);
    let pending = this.utility.get(key);
    if (pending === undefined) {
      pending = (async () => {
        const directory = path.join(this.stateDir, "native-utility");
        await mkdir(directory, { recursive: true });
        const sessionPath = path.join(directory, `${createHash("sha256").update(key).digest("hex").slice(0, 16)}.jsonl`);
        const data = params(await this.connection.send("open_session", { cwd, sessionPath, kind: "worker", auto_title: false }, this.options.startTimeoutMs ?? 60_000));
        const handle = data["sessionId"];
        if (typeof handle !== "string") throw new Error("omo open_session returned no session handle");
        this.utilityHandles.add(handle);
        const model = params(params(data["state"])["model"]);
        return { handle, model: typeof model["provider"] === "string" && typeof model["id"] === "string" ? { provider: model["provider"], id: model["id"] } : null };
      })();
      pending.catch(() => this.utility.delete(key));
      this.utility.set(key, pending);
    }
    return pending;
  }

  private async utilityCommand(cwd: string, command: string, fields: JsonObject = {}): Promise<unknown> {
    const { handle } = await this.utilitySession(cwd);
    return this.command(handle, command, fields);
  }

  private async listModels(): Promise<{ data: Model[]; nextCursor: null }> {
    const { model } = await this.utilitySession(this.options.cwd);
    const data = params(await this.utilityCommand(this.options.cwd, "get_available_models"));
    const models = Array.isArray(data["models"]) ? data["models"].filter(isRecord) : [];
    return { data: models.flatMap((entry) => wireModel(entry, model) ?? []), nextCursor: null };
  }

  private async listSkills(input: JsonObject): Promise<{ data: Array<{ cwd: string; skills: SkillMetadata[]; errors: Array<{ path: string; message: string }> }> }> {
    const cwds = Array.isArray(input["cwds"]) && input["cwds"].length > 0 ? input["cwds"].filter((cwd): cwd is string => typeof cwd === "string") : [this.options.cwd];
    const data = [];
    for (const cwd of cwds) {
      let isDirectory = false;
      try {
        isDirectory = statSync(cwd).isDirectory();
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      if (!isDirectory) {
        data.push({ cwd, skills: [], errors: [{ path: cwd, message: "skill cwd does not exist" }] });
        continue;
      }
      try {
        const live = [...this.sessions.values()].find((loaded) => samePath(loaded.cwd, cwd));
        const result = params(live === undefined ? await this.utilityCommand(cwd, "get_commands") : await this.command(live.handle, "get_commands"));
        const commands = Array.isArray(result["commands"]) ? result["commands"].filter(isRecord) : [];
        const skills: SkillMetadata[] = commands.flatMap((command) => {
          if (command["source"] !== "skill" || typeof command["name"] !== "string") return [];
          const info = params(command["sourceInfo"]);
          const file = typeof command["filePath"] === "string" ? command["filePath"] : typeof info["path"] === "string" ? info["path"] : "";
          return [{
            name: command["name"].replace(/^skill:/, ""),
            description: typeof command["description"] === "string" ? command["description"] : "",
            path: file,
            scope: skillScope(info["scope"]),
            enabled: command["disableModelInvocation"] !== true,
          }];
        });
        data.push({ cwd, skills, errors: [] });
      } catch (error) {
        data.push({ cwd, skills: [], errors: [{ path: cwd, message: error instanceof Error ? error.message : String(error) }] });
      }
    }
    return { data };
  }

  private async listMcp(threadId: string | null): Promise<{ data: McpServerStatus[]; nextCursor: null }> {
    const loaded = threadId === null ? undefined : this.sessions.get(threadId);
    const data = params(loaded === undefined ? await this.utilityCommand(this.options.cwd, "get_loaded_surfaces") : await this.command(loaded.handle, "get_loaded_surfaces"));
    const servers = Array.isArray(data["mcpServers"]) ? data["mcpServers"].filter(isRecord) : [];
    return {
      data: servers.flatMap((server) => typeof server["name"] === "string" ? [{
        name: server["name"],
        serverInfo: null,
        tools: {},
        resources: [],
        resourceTemplates: [],
        authStatus: typeof server["authStatus"] === "string" ? server["authStatus"] : "unsupported",
        // The settings page names a server waiting for a login needs_auth, whatever omo's connection state says.
        ...(server["authStatus"] === "notLoggedIn" ? { status: "needs_auth" } : typeof server["status"] === "string" ? { status: server["status"] } : {}),
        ...(typeof server["toolCount"] === "number" ? { toolCount: server["toolCount"] } : {}),
      }] : []),
      nextCursor: null,
    };
  }
}

function subscribe<T>(set: Set<T>, listener: T): () => void {
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}
