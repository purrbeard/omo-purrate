import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, stat } from "node:fs/promises";
import path from "node:path";
import type { CodexConvertedCounts, CodexImportOptions, CodexImportResult, CodexRolloutPreview, CodexUnsupportedReason } from "../../shared/codex-import";
import { sessionFolder } from "../omo/native/threads";
import { readSessionRecords } from "./session-lines";

export type CodexImportErrorCode = "invalid_record" | "malformed_line" | "truncated_line" | "invalid_image" | "unmatched_tool_result" | "source_changed" | "invalid_options" | "invalid_output";
export class CodexImportError extends Error {
  constructor(readonly code: CodexImportErrorCode, message: string, readonly line: number | null = null, readonly temporaryPath: string | null = null) {
    super(`${message}${line === null ? "" : ` (line ${line})`}`);
    this.name = "CodexImportError";
  }
}

type JsonObject = Record<string, unknown>;
type TextBlock = { readonly type: "text"; readonly text: string };
type ImageBlock = { readonly type: "image"; readonly data: string; readonly mimeType: string };
type Block = TextBlock | { readonly type: "thinking"; readonly thinking: string }
  | { readonly type: "toolCall"; readonly id: string; readonly name: string; readonly arguments: JsonObject };
type Sink = (entry: JsonObject) => Promise<void>;
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
function object(value: unknown, line: number): JsonObject {
  if (!isObject(value)) throw new CodexImportError("invalid_record", "Expected a JSON object", line);
  return value;
}
function required(value: unknown, line: number): string {
  if (typeof value !== "string" || value.trim() === "") throw new CodexImportError("invalid_record", "Missing required string", line);
  return value;
}
const optional = (value: unknown): string | null => typeof value === "string" && value.trim() !== "" ? value : null;
function date(value: unknown, line: number): string {
  const text = required(value, line);
  if (!Number.isFinite(Date.parse(text))) throw new CodexImportError("invalid_record", "Invalid timestamp", line);
  return text;
}
function parse(line: string, number: number): JsonObject {
  try { return object(JSON.parse(line), number); }
  catch (error) {
    if (error instanceof SyntaxError) throw new CodexImportError("malformed_line", "Malformed JSON record", number);
    throw error;
  }
}

/** Hash original bytes (including line endings), never decoded/re-serialized records. */
async function fingerprint(source: string): Promise<{ bytes: number; fingerprint: string }> {
  const before = await stat(source);
  const hash = createHash("sha256");
  const input = createReadStream(source, { highWaterMark: 1 << 20 });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  try {
    for await (const chunk of input) { decoder.decode(chunk, { stream: true }); hash.update(chunk); bytes += chunk.length; }
    decoder.decode();
  } catch (error) {
    if (error instanceof TypeError) throw new CodexImportError("invalid_record", "Invalid UTF-8 rollout");
    throw error;
  } finally { input.destroy(); }
  const after = await stat(source);
  if (bytes !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
    throw new CodexImportError("source_changed", "Source changed while fingerprinting");
  }
  return { bytes, fingerprint: `sha256:${hash.digest("hex")}` };
}

// allow: SIZE_OK - The assigned converter unit permits only one implementation file; this is one streaming parser.
async function scan(source: string, snapshot: Awaited<ReturnType<typeof fingerprint>>, emit?: Sink): Promise<CodexRolloutPreview> {
  const before = await stat(source);
  const converted: { -readonly [K in keyof CodexConvertedCounts]: number } = { userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, images: 0, reasoningBlocks: 0 };
  const losses = new Map<CodexUnsupportedReason, number>();
  const lose = (reason: CodexUnsupportedReason, count = 1) => losses.set(reason, (losses.get(reason) ?? 0) + count);
  const calls = new Map<string, string>();
  let sourceId = "", cwd: string | null = null, model: string | null = null, provider: string | null = null, timestamp = "";
  // Only the last assistant digest and one possible completion fallback are retained, never the transcript.
  let lastAssistant: string | null = null;
  let pending: { text: string; timestamp: string } | null = null;
  let line = 0;
  const send = async (at: string, message: JsonObject) => { if (emit) await emit({ type: "message", timestamp: at, message: { ...message, timestamp: Date.parse(at) } }); };
  const assistant = async (at: string, content: readonly Block[], stopReason = "stop") => {
    if (content.length === 0) return;
    converted.assistantMessages++;
    if (model === null) lose("missing_model");
    await send(at, { role: "assistant", content, api: "openai-responses", provider: provider ?? "", model: model ?? "", stopReason,
      // Native resume requires the object. Null preserves unknown; native stats coerce it to zero, so UI must use provenance.
      usage: { input: null, output: null, cacheRead: null, cacheWrite: null, totalTokens: null,
        cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null } } });
  };
  const flush = async () => {
    if (pending === null) return;
    await assistant(pending.timestamp, [{ type: "text", text: pending.text }]);
    lastAssistant = createHash("sha256").update(pending.text).digest("hex");
    pending = null;
  };
  const content = (value: unknown): (TextBlock | ImageBlock)[] => {
    if (typeof value === "string") return [{ type: "text", text: value }];
    if (!Array.isArray(value)) throw new CodexImportError("invalid_record", "Expected content blocks or text", line);
    const blocks: (TextBlock | ImageBlock)[] = [];
    for (const raw of value) {
      const block = object(raw, line);
      switch (block["type"]) {
        case "input_text": case "output_text": case "text":
          if (typeof block["text"] !== "string") throw new CodexImportError("invalid_record", "Invalid text block", line);
          blocks.push({ type: "text", text: block["text"] });
          break;
        case "input_image": case "image": {
          const url = block["image_url"] ?? block["url"];
          const reference = isObject(url) ? url["url"] : url;
          if (typeof reference !== "string" || !reference.startsWith("data:")) { lose("external_image"); break; }
          const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(reference);
          const mimeType = match?.[1], data = match?.[2];
          if (!mimeType || !data || data.length % 4 !== 0 || Buffer.from(data, "base64").toString("base64") !== data) {
            throw new CodexImportError("invalid_image", "Invalid embedded base64 image", line);
          }
          blocks.push({ type: "image", mimeType, data });
          converted.images++;
          break;
        }
        default: lose("unsupported_content");
      }
    }
    return blocks;
  };

  for await (const record of readSessionRecords(source, 0, snapshot.bytes)) {
    line++;
    if (!record.complete) throw new CodexImportError("truncated_line", "Unterminated rollout record", line);
    if (record.line.trim() === "") continue;
    const entry = parse(line === 1 ? record.line.replace(/^\uFEFF/, "") : record.line, line);
    const at = date(entry["timestamp"], line);
    const payload = object(entry["payload"], line);
    if (sourceId === "" && entry["type"] !== "session_meta") throw new CodexImportError("invalid_record", "First record must be session_meta", line);
    switch (entry["type"]) {
      case "session_meta": {
        if (sourceId !== "") throw new CodexImportError("invalid_record", "Duplicate session_meta", line);
        sourceId = required(payload["id"] ?? payload["session_id"], line);
        timestamp = optional(payload["timestamp"]) === null ? at : date(payload["timestamp"], line);
        cwd = optional(payload["cwd"]);
        provider = optional(payload["model_provider"]);
        model = optional(payload["model"]);
        for (const key of ["base_instructions", "instructions", "developer_instructions"]) if (payload[key] != null && payload[key] !== "") lose("source_instructions");
        if (emit) await emit({ type: "custom", customType: "codex-import", timestamp, data: { sourcePath: source, sourceId, sourceCwd: cwd,
          sourceProvider: provider, sourceModel: model, sourceTimestamp: timestamp, sourceVersion: optional(payload["cli_version"]), fingerprint: snapshot.fingerprint, usage: "unknown" } });
        break;
      }
      case "turn_context": {
        await flush();
        lastAssistant = null;
        model = optional(payload["model"]) ?? model;
        provider = optional(payload["model_provider"]) ?? provider;
        if (Object.keys(payload).some(key => !["model", "model_provider", "cwd", "timestamp"].includes(key))) lose("runtime_state");
        if (emit && model !== null) await emit({ type: "model_change", timestamp: at, provider: provider ?? "", modelId: model });
        break;
      }
      case "response_item": {
        switch (payload["type"]) {
          case "message": {
            const role = required(payload["role"], line);
            if (role === "system" || role === "developer") { lose("source_instructions"); break; }
            if (role !== "user" && role !== "assistant") { lose("unsupported_content"); break; }
            const blocks = content(payload["content"]);
            if (role === "user") {
              await flush();
              lastAssistant = null;
              converted.userMessages++;
              await send(at, { role, content: blocks });
            } else {
              const text = blocks.filter(block => block.type === "text").map(block => block.text).join("");
              const digest = createHash("sha256").update(text).digest("hex");
              if (pending !== null && createHash("sha256").update(pending.text).digest("hex") === digest) { pending = null; lose("duplicate_event"); }
              else await flush();
              const assistantBlocks: TextBlock[] = [];
              for (const block of blocks) {
                if (block.type === "image") { converted.images--; lose("unsupported_content"); }
                else assistantBlocks.push(block);
              }
              await assistant(at, assistantBlocks);
              lastAssistant = digest;
            }
            break;
          }
          case "reasoning": {
            if (payload["encrypted_content"] != null) lose("encrypted_reasoning");
            const blocks: Block[] = [];
            for (const field of ["summary", "content"]) {
              const value = payload[field];
              if (value == null) continue;
              if (!Array.isArray(value)) throw new CodexImportError("invalid_record", "Invalid reasoning blocks", line);
              for (const raw of value) {
                const block = object(raw, line);
                if (["summary_text", "reasoning_text", "text"].includes(String(block["type"])) && typeof block["text"] === "string") {
                  blocks.push({ type: "thinking", thinking: block["text"] }); converted.reasoningBlocks++;
                } else lose("unsupported_content");
              }
            }
            await assistant(at, blocks);
            break;
          }
          case "function_call": case "custom_tool_call": {
            await flush();
            const id = required(payload["call_id"], line), name = required(payload["name"], line);
            if (calls.has(id) || calls.size >= 1024) throw new CodexImportError("invalid_record", "Duplicate or excessive unresolved tool calls", line);
            const raw = payload["type"] === "custom_tool_call" ? payload["input"] : payload["arguments"];
            let args: JsonObject;
            if (payload["type"] === "custom_tool_call") {
              if (typeof raw !== "string") throw new CodexImportError("invalid_record", "Invalid custom tool input", line);
              args = { input: raw };
            } else if (typeof raw === "string") {
              try { const value: unknown = JSON.parse(raw); args = isObject(value) ? value : { input: raw }; }
              catch (error) { if (!(error instanceof SyntaxError)) throw error; args = { input: raw }; }
            } else args = object(raw, line);
            calls.set(id, name); converted.toolCalls++;
            await assistant(at, [{ type: "toolCall", id, name, arguments: args }], "toolUse");
            break;
          }
          case "function_call_output": case "custom_tool_call_output": {
            const id = required(payload["call_id"], line), name = calls.get(id);
            if (name === undefined) throw new CodexImportError("unmatched_tool_result", "Tool result has no matching call", line);
            const blocks = content(payload["output"]);
            calls.delete(id); converted.toolResults++;
            await send(at, { role: "toolResult", toolCallId: id, toolName: name, content: blocks, isError: payload["is_error"] === true });
            break;
          }
          default: lose("unsupported_record");
        }
        break;
      }
      case "event_msg": {
        switch (payload["type"]) {
          case "token_count": case "token_usage_record": lose("source_accounting"); break;
          case "agent_message": case "task_complete": case "item_completed": {
            const completed = isObject(payload["item"]) ? payload["item"] : {};
            const text = optional(payload["last_agent_message"] ?? payload["message"] ?? completed["text"]);
            if (text === null) { lose("duplicate_event"); break; }
            const digest = createHash("sha256").update(text).digest("hex");
            if (digest === lastAssistant || (pending !== null && pending.text === text)) { lose("duplicate_event"); break; }
            await flush(); pending = { text, timestamp: at };
            break;
          }
          case "user_message": case "agent_reasoning": lose("duplicate_event"); break;
          case "task_started":
            await flush(); lastAssistant = null; lose("runtime_state"); break;
          case "turn_aborted": case "context_compacted": lose("runtime_state"); break;
          default: lose("unsupported_event");
        }
        break;
      }
      case "token_usage_record": lose("source_accounting"); break;
      case "world_state": case "compacted": lose("runtime_state"); break;
      default: lose("unsupported_record");
    }
  }
  if (sourceId === "") throw new CodexImportError("invalid_record", "Missing session_meta", 1);
  await flush();
  if (calls.size > 0) lose("unmatched_tool_call", calls.size);
  const checked = await fingerprint(source);
  const after = await stat(source);
  if (checked.fingerprint !== snapshot.fingerprint || checked.bytes !== snapshot.bytes || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
    throw new CodexImportError("source_changed", "Source changed during conversion");
  }
  return { sourcePath: source, sourceId, cwd, model, provider, timestamp, ...snapshot, converted,
    unsupported: [...losses].sort(([left], [right]) => left.localeCompare(right)).map(([reason, count]) => ({ reason, count })) };
}

export async function previewCodexRollout(source: string): Promise<CodexRolloutPreview> {
  return scan(source, await fingerprint(source));
}

/** Validate the closed temporary file before its first .jsonl directory entry is admitted. */
async function validateOutput(file: string, expectedId: string): Promise<void> {
  const size = (await stat(file)).size;
  let parent: string | null = null, number = 0, lastType = "";
  for await (const record of readSessionRecords(file, 0, size)) {
    number++;
    if (!record.complete) throw new CodexImportError("invalid_output", "Incomplete native output", number);
    const entry = parse(record.line, number);
    if (number === 1) {
      if (entry["type"] !== "session" || entry["version"] !== 3 || entry["id"] !== expectedId) throw new CodexImportError("invalid_output", "Invalid native header", number);
    } else {
      if (entry["parentId"] !== parent || typeof entry["id"] !== "string") throw new CodexImportError("invalid_output", "Broken native parent chain", number);
      parent = entry["id"];
    }
    lastType = String(entry["type"]);
  }
  if (lastType !== "model_change") throw new CodexImportError("invalid_output", "Missing continuation model");
}

export async function importCodexRollout(source: string, sessionsDir: string, options: CodexImportOptions): Promise<CodexImportResult> {
  if (!path.isAbsolute(options.cwd) || options.provider.trim() === "" || options.model.trim() === "" || options.previewFingerprint.trim() === "") {
    throw new CodexImportError("invalid_options", "Choose an absolute cwd, an available continuation provider/model and a preview fingerprint");
  }
  const snapshot = await fingerprint(source);
  if (snapshot.fingerprint !== options.previewFingerprint) throw new CodexImportError("source_changed", "Source differs from the preview");
  const threadId = randomUUID(), timestamp = new Date().toISOString();
  await mkdir(sessionsDir, { recursive: true });
  // Exclusively reserve a new session folder so its final name cannot replace another session.
  const directory = path.join(sessionsDir, `${sessionFolder(options.cwd)}-codex-${threadId}`);
  await mkdir(directory);
  const target = path.join(directory, `${timestamp.replace(/[:.]/g, "-")}_${threadId}.jsonl`);
  const temporaryPath = `${target}.partial`;
  const output = await open(temporaryPath, "wx", 0o600);
  let parentId: string | null = null;
  const emit: Sink = async entry => {
    const id = randomUUID();
    await output.writeFile(`${JSON.stringify({ ...entry, id, parentId })}\n`);
    parentId = id;
  };
  try {
    let preview: CodexRolloutPreview;
    try {
      await output.writeFile(`${JSON.stringify({ type: "session", version: 3, id: threadId, timestamp, cwd: options.cwd })}\n`);
      preview = await scan(source, snapshot, emit);
      await emit({ type: "custom", customType: "codex-import-summary", timestamp, data: { converted: preview.converted, unsupported: preview.unsupported } });
      await emit({ type: "model_change", timestamp, provider: options.provider, modelId: options.model, source: "sdk", actor: "codex-import" });
      await output.sync();
    } finally { await output.close(); }
    await validateOutput(temporaryPath, threadId);
    const checked = await fingerprint(source);
    if (checked.fingerprint !== snapshot.fingerprint) throw new CodexImportError("source_changed", "Source changed before admission");
    // The reserved folder is private to this import. Rename admits the complete file atomically,
    // consumes the temporary name, and leaves failed non-admitted output intact.
    await rename(temporaryPath, target);
    return { path: target, threadId, preview };
  } catch (error) {
    if (error instanceof CodexImportError) throw new CodexImportError(error.code, error.message, error.line, temporaryPath);
    throw error;
  }
}
