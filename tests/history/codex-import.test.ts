import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { quarantineSync } from "../../scripts/quarantine-temp.mjs";
import { importCodexRollout, previewCodexRollout } from "../../electron/history/codex-import";
import * as lines from "../../electron/history/session-lines";
import { parseSessionJsonl } from "../../electron/history/session-jsonl";

vi.mock("node:fs/promises", async importOriginal => ({ ...await importOriginal<typeof import("node:fs/promises")>() }));
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) quarantineSync(root, { recursive: true, force: true });
});
const timestamp = "2026-11-01T00:00:00.000Z";
const later = "2026-11-01T00:00:01.000Z";
const cwd = path.resolve("/codex/project");
const meta = { timestamp, type: "session_meta", payload: { id: "codex-original", cwd, model_provider: "openai", cli_version: "0.60", base_instructions: "source-only instructions" } };
const context = { timestamp, type: "turn_context", payload: { model: "gpt-original", approval_policy: "never" } };
const item = (payload: object, at = timestamp) => ({ timestamp: at, type: "response_item", payload });
const user = item({ type: "message", role: "user", content: [{ type: "input_text", text: "synthetic user" }] });
const assistant = item({ type: "message", role: "assistant", content: [{ type: "output_text", text: "synthetic answer" }] }, later);
const jsonl = (values: readonly object[]) => values.map(value => JSON.stringify(value)).join("\r\n") + "\r\n";

async function fixture(text = jsonl([meta, context, user, assistant])) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "purrate-codex-"));
  roots.push(root);
  const source = path.join(root, "rollout.jsonl");
  const sessions = path.join(root, "sessions");
  await fs.mkdir(sessions);
  await fs.writeFile(source, text);
  return { root, source, sessions, text };
}
const options = (fingerprint: string) => ({ cwd, provider: "openai-codex", model: "gpt-continuation", previewFingerprint: fingerprint });
async function imported(f: Awaited<ReturnType<typeof fixture>>) {
  const preview = await previewCodexRollout(f.source);
  const saved = await importCodexRollout(f.source, f.sessions, options(preview.fingerprint));
  const records: Record<string, unknown>[] = [];
  for await (const line of lines.readSessionLines(saved.path)) records.push(JSON.parse(line));
  return { preview, saved, records };
}
async function files(root: string): Promise<string[]> {
  return (await fs.readdir(root, { withFileTypes: true })).flatMap(entry => entry.isFile() ? [path.join(root, entry.name)] : []);
}

describe("Codex rollout streaming converter", () => {
  it("previews only identity, fingerprint and exact counts without source content", async () => {
    const f = await fixture();
    const preview = await previewCodexRollout(f.source);
    expect(preview).toEqual({ sourcePath: f.source, sourceId: "codex-original", cwd, model: "gpt-original", provider: "openai", timestamp,
      bytes: Buffer.byteLength(f.text), fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      converted: { userMessages: 1, assistantMessages: 1, toolCalls: 0, toolResults: 0, images: 0, reasoningBlocks: 0 },
      unsupported: [{ reason: "runtime_state", count: 1 }, { reason: "source_instructions", count: 1 }] });
    expect(await fs.readFile(f.source, "utf8")).toBe(f.text);
  });

  it("writes fresh v3 identities, linear parents, source timestamps and unknown usage with a final continuation model", async () => {
    const f = await fixture();
    const { records, saved, preview } = await imported(f);
    const copy = await importCodexRollout(f.source, f.sessions, options(preview.fingerprint));
    expect(saved.threadId).toMatch(/^[a-f0-9-]{36}$/);
    expect(copy.threadId).not.toBe(saved.threadId);
    expect(records[0]).toMatchObject({ type: "session", version: 3, id: saved.threadId, cwd });
    expect(records[1]).toMatchObject({ type: "custom", customType: "codex-import", parentId: null,
      data: { sourceId: "codex-original", sourcePath: f.source, fingerprint: preview.fingerprint, usage: "unknown", sourceVersion: "0.60" } });
    for (let index = 2; index < records.length; index++) expect(records[index]?.["parentId"]).toBe(records[index - 1]?.["id"]);
    expect(records.filter(entry => entry["type"] === "message")).toEqual([
      expect.objectContaining({ timestamp, message: { role: "user", timestamp: Date.parse(timestamp), content: [{ type: "text", text: "synthetic user" }] } }),
      expect.objectContaining({ timestamp: later, message: expect.objectContaining({ role: "assistant", provider: "openai", model: "gpt-original", timestamp: Date.parse(later), stopReason: "stop",
        usage: { input: null, output: null, cacheRead: null, cacheWrite: null, totalTokens: null, cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null } } }) }),
    ]);
    expect(records.at(-1)).toMatchObject({ type: "model_change", provider: "openai-codex", modelId: "gpt-continuation" });
    expect(parseSessionJsonl(await fs.readFile(saved.path, "utf8")).turns).toHaveLength(1);
    expect(await fs.readFile(f.source, "utf8")).toBe(f.text);
  });

  it("preserves embedded images, arbitrary tool names, raw custom input, result block order and plain reasoning", async () => {
    const image = { type: "input_image", image_url: "data:image/png;base64,AQID" };
    const f = await fixture(jsonl([meta, context, item({ type: "message", role: "user", content: [image] }),
      item({ type: "reasoning", summary: [{ type: "summary_text", text: "visible thought" }], encrypted_content: "opaque" }),
      item({ type: "custom_tool_call", call_id: "call-custom", name: "vendor.arbitrary", input: "not JSON: raw(input)" }),
      item({ type: "custom_tool_call_output", call_id: "call-custom", output: [{ type: "input_text", text: "first" }, image, { type: "input_text", text: "last" }] }),
      item({ type: "function_call", call_id: "call-function", name: "another-tool", arguments: "{\"x\":4}" }),
      item({ type: "function_call_output", call_id: "call-function", output: "done" }), assistant]));
    const { preview, records } = await imported(f);
    expect(preview.converted).toEqual({ userMessages: 1, assistantMessages: 4, toolCalls: 2, toolResults: 2, images: 2, reasoningBlocks: 1 });
    expect(preview.unsupported).toContainEqual({ reason: "encrypted_reasoning", count: 1 });
    expect(records.filter(entry => entry["type"] === "message").map(entry => entry["message"])).toEqual([
      expect.objectContaining({ role: "user", content: [{ type: "image", mimeType: "image/png", data: "AQID" }] }),
      expect.objectContaining({ role: "assistant", content: [{ type: "thinking", thinking: "visible thought" }] }),
      expect.objectContaining({ role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "call-custom", name: "vendor.arbitrary", arguments: { input: "not JSON: raw(input)" } }] }),
      expect.objectContaining({ role: "toolResult", toolCallId: "call-custom", toolName: "vendor.arbitrary", content: [{ type: "text", text: "first" }, { type: "image", mimeType: "image/png", data: "AQID" }, { type: "text", text: "last" }] }),
      expect.objectContaining({ role: "assistant", content: [{ type: "toolCall", id: "call-function", name: "another-tool", arguments: { x: 4 } }] }),
      expect.objectContaining({ role: "toolResult", toolCallId: "call-function", toolName: "another-tool", content: [{ type: "text", text: "done" }] }),
      expect.objectContaining({ role: "assistant", content: [{ type: "text", text: "synthetic answer" }] }),
    ]);
  });

  it("groups source-only losses without elevating instructions or duplicating mirrored messages", async () => {
    const f = await fixture(jsonl([meta, context, user, assistant,
      item({ type: "message", role: "developer", content: [{ type: "input_text", text: "do not execute" }] }),
      item({ type: "message", role: "system", content: [] }),
      { timestamp, type: "event_msg", payload: { type: "agent_message", message: "synthetic answer" } },
      item({ type: "message", role: "user", content: [{ type: "input_image", image_url: "https://invalid/image.png" }, { type: "audio" }] }),
      { timestamp, type: "event_msg", payload: { type: "token_count", info: { total_tokens: 14 } } },
      { timestamp, type: "event_msg", payload: { type: "unexpected-event" } },
      { timestamp, type: "world_state", payload: {} }, { timestamp, type: "future_record", payload: {} }]));
    const { preview, records } = await imported(f);
    expect(preview.unsupported).toEqual([
      { reason: "duplicate_event", count: 1 }, { reason: "external_image", count: 1 }, { reason: "runtime_state", count: 2 },
      { reason: "source_accounting", count: 1 }, { reason: "source_instructions", count: 3 }, { reason: "unsupported_content", count: 1 },
      { reason: "unsupported_event", count: 1 }, { reason: "unsupported_record", count: 1 },
    ]);
    const messages = records.filter(entry => entry["type"] === "message");
    expect(messages).toHaveLength(3);
    expect(messages.at(-1)).toMatchObject({ message: { role: "user", content: [] } });
    expect(preview.converted.userMessages).toBe(2);
    expect(records.some(entry => entry["type"] === "custom_message")).toBe(false);
  });

  it.each(["before", "after"])("deduplicates a completion mirror %s the canonical assistant record", async order => {
    const event = { timestamp: later, type: "event_msg", payload: { type: "task_complete", last_agent_message: "synthetic answer" } };
    const f = await fixture(jsonl([meta, context, user, ...(order === "before" ? [event, assistant] : [assistant, event])]));
    const { records, preview } = await imported(f);
    expect(preview.converted.assistantMessages).toBe(1);
    expect(preview.unsupported).toContainEqual({ reason: "duplicate_event", count: 1 });
    expect(records.filter(entry => entry["type"] === "message")).toHaveLength(2);
  });

  it("preserves completion-only assistant text once when no response_item mirror exists", async () => {
    const event = { timestamp: later, type: "event_msg", payload: { type: "task_complete", last_agent_message: "completion only" } };
    const f = await fixture(jsonl([meta, context, user, event]));
    const { records, preview } = await imported(f);
    expect(preview.converted.assistantMessages).toBe(1);
    expect(records.filter(entry => entry["type"] === "message").at(-1)).toMatchObject({ timestamp: later,
      message: { role: "assistant", content: [{ type: "text", text: "completion only" }] } });
  });

  it.each(["user", "context", "started"])("preserves an identical completion in a later turn after a %s boundary", async boundary => {
    const marker = boundary === "user" ? user : boundary === "context" ? context :
      { timestamp: later, type: "event_msg", payload: { type: "task_started" } };
    const event = { timestamp: later, type: "event_msg", payload: { type: "task_complete", last_agent_message: "synthetic answer" } };
    const f = await fixture(jsonl([meta, context, user, assistant, marker, event]));
    const { records, preview } = await imported(f);
    expect(preview.converted.assistantMessages).toBe(2);
    expect(records.filter(entry => entry["type"] === "message").at(-1)).toMatchObject({ message: {
      role: "assistant", content: [{ type: "text", text: "synthetic answer" }],
    } });
  });

  it("admits only one file name so later native appends have no retained temporary alias", async () => {
    const f = await fixture();
    const { saved } = await imported(f);
    await fs.appendFile(saved.path, JSON.stringify({ type: "custom", customType: "later-native-write", data: "continued" }) + "\n");
    expect(await fs.readdir(path.dirname(saved.path))).toEqual([path.basename(saved.path)]);
    expect((await fs.stat(saved.path)).nlink).toBe(1);
    expect(await fs.readFile(f.source, "utf8")).toBe(f.text);
  });

  it("preserves JSON-shaped custom tool input as the exact original string", async () => {
    const input = '  {"x":1}  ';
    const f = await fixture(jsonl([meta, context, user,
      item({ type: "custom_tool_call", call_id: "json-shaped", name: "custom", input }),
      item({ type: "custom_tool_call_output", call_id: "json-shaped", output: "done" }), assistant]));
    const { records } = await imported(f);
    expect(records.filter(entry => entry["type"] === "message")[1]).toMatchObject({ message: { content: [
      { type: "toolCall", id: "json-shaped", name: "custom", arguments: { input } },
    ] } });
  });

  it("tracks last known model across turns and counts missing original model without inventing one", async () => {
    const f = await fixture(jsonl([meta, user, assistant, context, assistant, { ...context, payload: { model: "gpt-later" } }, assistant]));
    const { records, preview } = await imported(f);
    expect(preview.model).toBe("gpt-later");
    expect(preview.unsupported).toContainEqual({ reason: "missing_model", count: 1 });
    expect(records.filter(entry => entry["type"] === "message").slice(1).map(entry => entry["message"])).toEqual([
      expect.objectContaining({ model: "" }), expect.objectContaining({ model: "gpt-original" }), expect.objectContaining({ model: "gpt-later" }),
    ]);
  });

  it.each([
    ["malformed_line", jsonl([meta, user]) + "{broken\n", 3],
    ["truncated_line", jsonl([meta, user]) + JSON.stringify(assistant), 3],
    ["invalid_image", jsonl([meta, item({ type: "message", role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,%%%" }] })]), 2],
    ["invalid_image", jsonl([meta, item({ type: "message", role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,AB==" }] })]), 2],
    ["unmatched_tool_result", jsonl([meta, item({ type: "function_call_output", call_id: "missing", output: "result" })]), 2],
    ["invalid_record", jsonl([meta, { timestamp: "invalid", type: "response_item", payload: { type: "message", role: "user", content: [] } }]), 2],
    ["invalid_record", jsonl([meta, item({ type: "function_call", call_id: "", name: "tool", arguments: "{}" })]), 2],
  ])("rejects %s with line evidence and no admitted output", async (code, text, line) => {
    const f = await fixture(text);
    await expect(previewCodexRollout(f.source)).rejects.toMatchObject({ code, line });
    const fingerprint = `sha256:${createHash("sha256").update(text).digest("hex")}`;
    await expect(importCodexRollout(f.source, f.sessions, options(fingerprint))).rejects.toMatchObject({ code, line, temporaryPath: expect.stringMatching(/\.partial$/) });
    const names = await fs.readdir(f.sessions, { recursive: true });
    expect(names.filter(name => String(name).endsWith(".jsonl"))).toEqual([]);
    expect(names.filter(name => String(name).endsWith(".partial"))).toHaveLength(1);
    expect(await fs.readFile(f.source, "utf8")).toBe(text);
  });

  it("counts unfinished calls and preserves their identity rather than inventing successful results", async () => {
    const f = await fixture(jsonl([meta, context, user, item({ type: "function_call", call_id: "unfinished", name: "any", arguments: "raw input" })]));
    const { records, preview } = await imported(f);
    expect(preview.unsupported).toContainEqual({ reason: "unmatched_tool_call", count: 1 });
    expect(preview.converted.toolResults).toBe(0);
    expect(records.filter(entry => entry["type"] === "message").at(-1)).toMatchObject({ message: {
      content: [{ type: "toolCall", id: "unfinished", name: "any", arguments: { input: "raw input" } }],
    } });
  });

  it("rejects a stale preview even when replacement source has the same byte length", async () => {
    const f = await fixture();
    const preview = await previewCodexRollout(f.source);
    await fs.writeFile(f.source, f.text.replace("synthetic user", "different user"));
    await expect(importCodexRollout(f.source, f.sessions, options(preview.fingerprint))).rejects.toMatchObject({ code: "source_changed" });
    expect((await fs.readdir(f.sessions, { recursive: true })).filter(name => String(name).endsWith(".jsonl"))).toEqual([]);
  });

  it("rejects changes during conversion and retains a clearly non-admitted partial artifact", async () => {
    const f = await fixture();
    const preview = await previewCodexRollout(f.source);
    const original = lines.readSessionRecords;
    let changed = false;
    vi.spyOn(lines, "readSessionRecords").mockImplementation(async function* (...args) {
      for await (const record of original(...args)) {
        yield record;
        if (args[0] === f.source && !changed) {
          changed = true;
          await fs.writeFile(f.source, f.text.replace("synthetic user", "different user"));
        }
      }
    });
    await expect(importCodexRollout(f.source, f.sessions, options(preview.fingerprint))).rejects.toMatchObject({ code: "source_changed", temporaryPath: expect.stringMatching(/\.partial$/) });
    const names = await fs.readdir(f.sessions, { recursive: true });
    expect(names.filter(name => String(name).endsWith(".jsonl"))).toEqual([]);
    expect(names.filter(name => String(name).endsWith(".partial"))).toHaveLength(1);
  });

  it("streams a large rollout without whole-file reads and preserves every message", async () => {
    const f = await fixture(jsonl([meta, context]));
    const handle = await fs.open(f.source, "a");
    try { for (let index = 0; index < 10000; index++) await handle.write(jsonl([index % 2 === 0 ? user : assistant])); }
    finally { await handle.close(); }
    const readFile = fs.readFile;
    vi.spyOn(fs, "readFile").mockImplementation((...args) => {
      if (args[0] === f.source) throw new Error("Whole rollout read is forbidden");
      return readFile(...args);
    });
    const preview = await previewCodexRollout(f.source);
    const saved = await importCodexRollout(f.source, f.sessions, options(preview.fingerprint));
    let messages = 0;
    for await (const line of lines.readSessionLines(saved.path)) if (JSON.parse(line).type === "message") messages++;
    expect(messages).toBe(10000);
    expect(preview.converted).toMatchObject({ userMessages: 5000, assistantMessages: 5000 });
    expect(await files(f.root)).toHaveLength(1);
  });
});
