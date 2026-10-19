import { randomUUID } from "node:crypto";
import type { ContextCompactionReason, RpcNotification, ThreadItem, Turn, TurnStatus, UserInput } from "../../../shared/protocol";
import { toolFileChanges } from "./file-changes";

type JsonObject = Record<string, unknown>;
type ItemType = "commandExecution" | "fileChange" | "mcpToolCall" | "dynamicToolCall";

const MAX_TOOL_OUTPUT_BYTES = 256 * 1024;
const MCP_TOOL_NAME = /^[^_]+__/;

interface ToolState {
  id: string;
  name: string;
  itemType: ItemType;
  args: unknown;
  output: string;
  completed: boolean;
}

interface TextState {
  id: string;
  text: string;
  completed: boolean;
}

interface ActiveTurn {
  id: string;
  startedAtMs: number;
  items: ThreadItem[];
  completedIds: Set<string>;
  tools: Map<string, ToolState>;
  texts: Map<number, TextState>;
  reasoning: Map<number, TextState>;
  messageId: string | null;
  messageCounter: number;
  compactionId: string | null;
  compactionReason: ContextCompactionReason | null;
  outcome: { status: TurnStatus; error: string | null } | null;
  interrupted: boolean;
  userMessageShown: boolean;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactionReason(value: unknown): ContextCompactionReason | null {
  return value === "manual" || value === "threshold" || value === "overflow" ? value : null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(record: JsonObject, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function capUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (byteLength(value) <= maxBytes) return value;
  let used = 0;
  let result = "";
  for (const char of value) {
    const size = byteLength(char);
    if (used + size > maxBytes) break;
    used += size;
    result += char;
  }
  return result;
}

export function classifyTool(name: string): ItemType {
  if (name === "bash") return "commandExecution";
  if (name === "edit" || name === "write" || name === "apply_patch") return "fileChange";
  if (MCP_TOOL_NAME.test(name)) return "mcpToolCall";
  return "dynamicToolCall";
}

function toolText(result: unknown): string {
  if (!isRecord(result)) return "";
  const content = result["content"];
  if (!Array.isArray(content)) return readString(result, "text") ?? "";
  return content.map((item) => (isRecord(item) && item["type"] === "text" ? readString(item, "text") ?? "" : "")).join("");
}

function commandOf(args: unknown): string {
  if (!isRecord(args)) return "";
  return readString(args, "command") ?? readString(args, "cmd") ?? JSON.stringify(args) ?? "";
}

function exitCodeOf(result: unknown): number | null {
  if (!isRecord(result) || !isRecord(result["details"])) return null;
  const value = result["details"]["exitCode"] ?? result["details"]["code"];
  return typeof value === "number" ? value : null;
}

function userInputFrom(content: unknown): UserInput[] {
  if (typeof content === "string") return [{ type: "text", text: content, text_elements: [] }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part): UserInput[] => {
    if (!isRecord(part)) return [];
    if (part["type"] === "text" && typeof part["text"] === "string") return [{ type: "text", text: part["text"], text_elements: [] }];
    if (part["type"] === "image" && typeof part["data"] === "string" && typeof part["mimeType"] === "string") {
      return [{ type: "image", url: `data:${part["mimeType"]};base64,${part["data"]}` }];
    }
    return [];
  });
}

/**
 * Projects one omo session's native RPC events onto the app-server turn and item notifications the renderer reads.
 * A port of the projection the removed `omo app-server` ran in-process (TurnEngine + EventProjector).
 */
/** One input omo holds in its steering or follow-up queue; `queuedId` is null when omo reports the legacy text-only lists. */
export interface QueuedInput {
  queuedId: string | null;
  mode: "steer" | "followUp";
  text: string;
}

function inputText(input: UserInput[]): string {
  return input.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

export class TurnProjector {
  private active: ActiveTurn | null = null;
  /** Texts of steers this client already shows as a user bubble, so the queue list leaves them out. */
  private shownSteers: string[] = [];
  /**
   * Follow-ups queued by this client whose user message has not been shown yet; shown when omo delivers them.
   * `queuedId` is learned from omo's queue updates, which can arrive before or after the send response.
   */
  private owedFollowUps: Array<{ queuedId: string | null; text: string }> = [];
  private queue: QueuedInput[] = [];

  constructor(
    readonly threadId: string,
    private readonly cwd: string,
    private readonly emit: (notification: RpcNotification) => void,
    private readonly now: () => number = Date.now,
  ) {}

  get activeTurnId(): string | null {
    return this.active?.id ?? null;
  }

  beginClientTurn(input: UserInput[], clientId: string | null): Turn {
    const turn = this.open();
    this.showUserMessage(turn, input, clientId);
    return this.wireTurn(turn, "inProgress", null);
  }

  showSteer(input: UserInput[]): void {
    if (this.active === null) return;
    this.shownSteers.push(inputText(input));
    this.showUserMessage(this.active, input, null);
  }

  /** A follow-up sits in omo's queue: its bubble appears when omo delivers it, not now. */
  expectFollowUp(text: string): void {
    const owed = { queuedId: null, text };
    this.claimQueuedId(owed);
    this.owedFollowUps.push(owed);
  }

  private claimQueuedId(owed: { queuedId: string | null; text: string }): void {
    if (owed.queuedId !== null) return;
    const row = this.queue.find((item) => item.mode === "followUp" && item.queuedId !== null && item.text === owed.text
      && !this.owedFollowUps.some((other) => other.queuedId === item.queuedId));
    if (row !== undefined) owed.queuedId = row.queuedId;
  }

  /** Records omo's queue and returns what the queue list shows: every queued input except steers already shown as a bubble. */
  setQueue(items: QueuedInput[]): QueuedInput[] {
    this.queue = items;
    for (const owed of this.owedFollowUps) {
      // An edited follow-up keeps its id and is shown with its new text once delivered.
      const row = items.find((item) => owed.queuedId !== null && item.queuedId === owed.queuedId);
      if (row !== undefined) owed.text = row.text;
      else this.claimQueuedId(owed);
    }
    const pending = [...this.shownSteers];
    const kept: string[] = [];
    const visible = items.filter((item) => {
      if (item.mode !== "steer") return true;
      const at = pending.indexOf(item.text);
      if (at < 0) return true;
      pending.splice(at, 1);
      kept.push(item.text);
      return false;
    });
    this.shownSteers = kept;
    return visible;
  }

  /** A follow-up left the queue without delivery (withdrawn): its bubble is no longer owed. */
  dropFollowUp(queuedId: string): void {
    const at = this.owedFollowUps.findIndex((owed) => owed.queuedId === queuedId);
    if (at >= 0) this.owedFollowUps.splice(at, 1);
  }

  markInterrupted(): void {
    if (this.active !== null) this.active.interrupted = true;
  }

  /** Completes the running turn with no further events, for an input omo handled without a run. */
  completeNow(status: TurnStatus = "completed"): void {
    if (this.active !== null) this.finish(status === "completed" && this.active.interrupted ? "interrupted" : status, null);
  }

  handle(event: JsonObject): void {
    switch (event["type"]) {
      case "agent_start":
        if (this.active === null) this.open();
        return;
      case "message_start":
        this.messageStart(event["message"]);
        return;
      case "message_update":
        this.messageUpdate(event);
        return;
      case "message_end":
        this.messageEnd(event["message"]);
        return;
      case "tool_execution_start":
        this.rememberTool(event);
        return;
      case "tool_execution_update":
        this.toolUpdate(event);
        return;
      case "tool_execution_end":
        this.toolEnd(event);
        return;
      case "compaction_start":
        this.compactionStart(event);
        return;
      case "compaction_end":
        this.compactionEnd(event);
        return;
      // The removed app-server ended a turn on agent_end; a retry or continuation after it opens its own turn.
      case "agent_end":
      case "agent_settled":
        this.settle();
        return;
      default:
        return;
    }
  }

  /** The session ended under the turn (closed, parked, host exit): close it as interrupted. */
  abandon(): void {
    if (this.active !== null) this.finish("interrupted", null);
  }

  private open(): ActiveTurn {
    const turn: ActiveTurn = {
      id: randomUUID(),
      startedAtMs: this.now(),
      items: [],
      completedIds: new Set(),
      tools: new Map(),
      texts: new Map(),
      reasoning: new Map(),
      messageId: null,
      messageCounter: 0,
      compactionId: null,
      compactionReason: null,
      outcome: null,
      interrupted: false,
      userMessageShown: false,
    };
    this.active = turn;
    this.emit({ method: "thread/status/changed", params: { threadId: this.threadId, status: { type: "active", activeFlags: [] } } });
    this.emit({ method: "turn/started", params: { threadId: this.threadId, turn: this.wireTurn(turn, "inProgress", null) } });
    return turn;
  }

  private showUserMessage(turn: ActiveTurn, content: UserInput[], clientId: string | null): void {
    turn.userMessageShown = true;
    const item: ThreadItem = { type: "userMessage", id: clientId ?? randomUUID(), clientId, content };
    const at = this.now();
    this.emit({ method: "item/started", params: { threadId: this.threadId, turnId: turn.id, item, startedAtMs: at } });
    this.completed(turn, item);
  }

  private messageStart(message: unknown): void {
    if (!isRecord(message)) return;
    if (message["role"] === "user") {
      const turn = this.active ?? this.open();
      const content = userInputFrom(message["content"]);
      const owed = this.owedFollowUps.findIndex((entry) => entry.text === inputText(content));
      if (owed >= 0) {
        this.owedFollowUps.splice(owed, 1);
        this.showUserMessage(turn, content, null);
      } else if (!turn.userMessageShown) this.showUserMessage(turn, content, null);
      return;
    }
    if (message["role"] !== "assistant") return;
    const turn = this.active ?? this.open();
    turn.messageCounter += 1;
    turn.messageId = readString(message, "responseId") ?? `${turn.id}:message-${turn.messageCounter}`;
    turn.texts.clear();
    turn.reasoning.clear();
  }

  private messageUpdate(event: JsonObject): void {
    const turn = this.active;
    const delta = event["assistantMessageEvent"];
    if (turn === null || !isRecord(delta)) return;
    const index = typeof delta["contentIndex"] === "number" ? delta["contentIndex"] : 0;
    switch (delta["type"]) {
      case "text_start":
        this.startText(turn, turn.texts, index, "agentMessage");
        return;
      case "text_delta": {
        const state = turn.texts.get(index) ?? this.startText(turn, turn.texts, index, "agentMessage");
        const text = readString(delta, "delta") ?? "";
        state.text += text;
        this.emit({ method: "item/agentMessage/delta", params: { threadId: this.threadId, turnId: turn.id, itemId: state.id, delta: text } });
        return;
      }
      case "text_end":
        this.completeText(turn, turn.texts, index, "agentMessage", readString(delta, "content"));
        return;
      case "thinking_start":
        this.startText(turn, turn.reasoning, index, "reasoning");
        return;
      case "thinking_delta": {
        const state = turn.reasoning.get(index) ?? this.startText(turn, turn.reasoning, index, "reasoning");
        const text = readString(delta, "delta") ?? "";
        state.text += text;
        this.emit({ method: "item/reasoning/textDelta", params: { threadId: this.threadId, turnId: turn.id, itemId: state.id, delta: text, contentIndex: index } });
        return;
      }
      case "thinking_end":
        this.completeText(turn, turn.reasoning, index, "reasoning", readString(delta, "content"));
        return;
      case "toolcall_end": {
        const call = delta["toolCall"];
        if (!isRecord(call) || typeof call["id"] !== "string") return;
        const name = readString(event, "resolvedToolName") ?? readString(call, "name") ?? "tool";
        this.startTool(turn, call["id"], name, call["arguments"]);
        return;
      }
      default:
        return;
    }
  }

  private messageEnd(message: unknown): void {
    const turn = this.active;
    if (turn === null || !isRecord(message) || message["role"] !== "assistant") return;
    const content = Array.isArray(message["content"]) ? message["content"] : [];
    content.forEach((block, index) => {
      if (!isRecord(block)) return;
      if (block["type"] === "text" && typeof block["text"] === "string" && !turn.texts.get(index)?.completed) {
        this.completeText(turn, turn.texts, index, "agentMessage", block["text"]);
      } else if (block["type"] === "thinking" && typeof block["thinking"] === "string" && !turn.reasoning.get(index)?.completed) {
        this.completeText(turn, turn.reasoning, index, "reasoning", block["thinking"]);
      }
    });
    const stopReason = message["stopReason"];
    if (stopReason === "aborted") turn.outcome = { status: "interrupted", error: null };
    else if (stopReason === "error") turn.outcome = { status: "failed", error: readString(message, "errorMessage") ?? "Turn failed" };
    else turn.outcome = { status: "completed", error: null };
  }

  private startText(turn: ActiveTurn, map: Map<number, TextState>, index: number, type: "agentMessage" | "reasoning"): TextState {
    const state: TextState = { id: `${turn.messageId ?? `${turn.id}:message-0`}:${index}`, text: "", completed: false };
    map.set(index, state);
    const item: ThreadItem = type === "agentMessage"
      ? { type, id: state.id, text: "", phase: null }
      : { type, id: state.id, summary: [], content: [] };
    this.emit({ method: "item/started", params: { threadId: this.threadId, turnId: turn.id, item, startedAtMs: this.now() } });
    return state;
  }

  private completeText(turn: ActiveTurn, map: Map<number, TextState>, index: number, type: "agentMessage" | "reasoning", text: string | undefined): void {
    const state = map.get(index) ?? this.startText(turn, map, index, type);
    if (state.completed) return;
    if (text !== undefined) state.text = text;
    state.completed = true;
    this.completed(turn, type === "agentMessage"
      ? { type, id: state.id, text: state.text, phase: null }
      : { type, id: state.id, summary: [], content: [state.text] });
  }

  private startTool(turn: ActiveTurn, id: string, name: string, args: unknown): void {
    const existing = turn.tools.get(id);
    if (existing !== undefined) return;
    const tool: ToolState = { id, name, itemType: classifyTool(name), args, output: "", completed: false };
    turn.tools.set(id, tool);
    this.emit({ method: "item/started", params: { threadId: this.threadId, turnId: turn.id, item: this.toolItem(tool, "inProgress", false, undefined), startedAtMs: this.now() } });
  }

  private rememberTool(event: JsonObject): void {
    const turn = this.active ?? this.open();
    const id = readString(event, "toolCallId");
    if (id === undefined || turn.tools.has(id)) return;
    this.startTool(turn, id, readString(event, "toolName") ?? "tool", event["args"]);
  }

  private toolUpdate(event: JsonObject): void {
    const turn = this.active;
    const id = readString(event, "toolCallId");
    const tool = id === undefined ? undefined : turn?.tools.get(id);
    if (turn === null || tool === undefined || tool.itemType !== "commandExecution") return;
    const partial = toolText(event["partialResult"]);
    if (!partial.startsWith(tool.output)) return;
    const delta = capUtf8(partial.slice(tool.output.length), MAX_TOOL_OUTPUT_BYTES - byteLength(tool.output));
    if (delta === "") return;
    tool.output += delta;
    this.emit({ method: "item/commandExecution/outputDelta", params: { threadId: this.threadId, turnId: turn.id, itemId: tool.id, delta } });
  }

  private toolEnd(event: JsonObject): void {
    const turn = this.active;
    const id = readString(event, "toolCallId");
    if (turn === null || id === undefined) return;
    if (!turn.tools.has(id)) this.startTool(turn, id, readString(event, "toolName") ?? "tool", event["args"]);
    this.completeTool(turn, turn.tools.get(id)!, event["isError"] === true, event["result"]);
  }

  private completeTool(turn: ActiveTurn, tool: ToolState, isError: boolean, result: unknown): void {
    if (tool.completed) return;
    tool.completed = true;
    const text = toolText(result);
    if (tool.itemType === "commandExecution" && text !== "") tool.output = capUtf8(text, MAX_TOOL_OUTPUT_BYTES);
    this.completed(turn, this.toolItem(tool, isError ? "failed" : "completed", isError, result));
  }

  private toolItem(tool: ToolState, status: "inProgress" | "completed" | "failed", isError: boolean, result: unknown): ThreadItem {
    switch (tool.itemType) {
      case "commandExecution":
        return {
          type: "commandExecution", id: tool.id, command: commandOf(tool.args), cwd: this.cwd, status,
          aggregatedOutput: tool.output === "" ? null : tool.output, exitCode: status === "inProgress" ? null : exitCodeOf(result), durationMs: null,
        };
      case "fileChange":
        return { type: "fileChange", id: tool.id, changes: status === "inProgress" ? [] : toolFileChanges(tool.name, tool.args, isRecord(result) ? result["details"] : undefined), status };
      case "mcpToolCall": {
        const marker = tool.name.indexOf("__");
        return {
          type: "mcpToolCall", id: tool.id, server: tool.name.slice(0, marker), tool: tool.name.slice(marker + 2),
          status, arguments: tool.args ?? null,
          result: status === "completed" && isRecord(result) ? { content: Array.isArray(result["content"]) ? result["content"] : [], structuredContent: null } : null,
          error: status === "failed" ? { message: toolText(result) || "Tool execution failed" } : null, durationMs: null,
        };
      }
      case "dynamicToolCall": {
        const changes = status === "completed" ? toolFileChanges(tool.name, tool.args, isRecord(result) ? result["details"] : undefined) : [];
        return {
          type: "dynamicToolCall", id: tool.id, namespace: null, tool: tool.name, arguments: tool.args ?? null, status,
          contentItems: status === "inProgress" ? null : [{ type: "inputText", text: toolText(result) }],
          success: status === "inProgress" ? null : !isError, durationMs: null, ...(changes.length === 0 ? {} : { changes }),
        };
      }
    }
  }

  private compactionStart(event: JsonObject): void {
    const turn = this.active ?? this.open();
    turn.compactionId = `context-compaction:${randomUUID()}`;
    turn.compactionReason = compactionReason(event["reason"]);
    const item: ThreadItem = { type: "contextCompaction", id: turn.compactionId, reason: turn.compactionReason, status: "inProgress" };
    this.emit({ method: "item/started", params: { threadId: this.threadId, turnId: turn.id, item, startedAtMs: this.now() } });
  }

  private compactionEnd(event: JsonObject): void {
    const turn = this.active;
    if (turn === null || turn.compactionId === null) return;
    const id = turn.compactionId;
    const reason = compactionReason(event["reason"]) ?? turn.compactionReason;
    turn.compactionId = null;
    turn.compactionReason = null;
    // rpc.md compaction_end: `result` null with `aborted` means cancelled, without it a failure carrying `errorMessage`.
    const result = isRecord(event["result"]) ? event["result"] : null;
    const aborted = result === null && event["aborted"] === true;
    const summary = result?.["summary"];
    this.completed(turn, {
      type: "contextCompaction",
      id,
      reason,
      status: result !== null ? "completed" : aborted ? "aborted" : "failed",
      tokensBefore: finiteOrNull(result?.["tokensBefore"]),
      estimatedTokensAfter: finiteOrNull(result?.["estimatedTokensAfter"]),
      summary: typeof summary === "string" && summary.trim() !== "" ? summary : null,
      error: result === null && !aborted && typeof event["errorMessage"] === "string" ? event["errorMessage"] : null,
      willRetry: result !== null && event["willRetry"] === true,
    });
    // A manual compaction runs outside any agent run, so no agent_settled closes its synthetic turn.
    if (turn.outcome === null && turn.tools.size === 0 && turn.texts.size === 0 && !turn.userMessageShown) {
      const failed = event["result"] === null && event["aborted"] !== true && typeof event["errorMessage"] === "string";
      this.finish(failed ? "failed" : event["aborted"] === true ? "interrupted" : "completed", failed ? String(event["errorMessage"]) : null);
    }
  }

  private settle(): void {
    const turn = this.active;
    if (turn === null) return;
    const outcome = turn.outcome ?? { status: "completed" as TurnStatus, error: null };
    this.finish(turn.interrupted && outcome.status === "completed" ? "interrupted" : outcome.status, outcome.error);
  }

  private finish(status: TurnStatus, error: string | null): void {
    const turn = this.active;
    if (turn === null) return;
    for (const [index, state] of turn.texts) if (!state.completed) this.completeText(turn, turn.texts, index, "agentMessage", undefined);
    for (const [index, state] of turn.reasoning) if (!state.completed) this.completeText(turn, turn.reasoning, index, "reasoning", undefined);
    for (const tool of turn.tools.values()) if (!tool.completed) this.completeTool(turn, tool, false, undefined);
    // The turn ended before compaction_end arrived: the compaction did not finish.
    if (turn.compactionId !== null) this.completed(turn, { type: "contextCompaction", id: turn.compactionId, reason: turn.compactionReason, status: "aborted" });
    this.active = null;
    const wire = this.wireTurn(turn, status, error);
    this.emit({ method: "thread/status/changed", params: { threadId: this.threadId, status: { type: "idle" } } });
    if (status === "failed" && wire.error !== null) {
      this.emit({ method: "error", params: { threadId: this.threadId, turnId: turn.id, error: wire.error, willRetry: false } });
    }
    this.emit({ method: "turn/completed", params: { threadId: this.threadId, turn: wire } });
  }

  private completed(turn: ActiveTurn, item: ThreadItem): void {
    if (!turn.completedIds.has(item.id)) {
      turn.completedIds.add(item.id);
      turn.items.push(item);
    }
    this.emit({ method: "item/completed", params: { threadId: this.threadId, turnId: turn.id, item, completedAtMs: this.now() } });
  }

  private wireTurn(turn: ActiveTurn, status: TurnStatus, error: string | null): Turn {
    const completedAtMs = status === "inProgress" ? null : this.now();
    return {
      id: turn.id,
      items: status === "inProgress" ? [] : [...turn.items],
      itemsView: "full",
      status,
      error: status === "failed" ? { message: error ?? "Turn failed", codexErrorInfo: "other", additionalDetails: null } : null,
      startedAt: turn.startedAtMs / 1000,
      completedAt: completedAtMs === null ? null : completedAtMs / 1000,
      durationMs: completedAtMs === null ? null : completedAtMs - turn.startedAtMs,
    };
  }
}
