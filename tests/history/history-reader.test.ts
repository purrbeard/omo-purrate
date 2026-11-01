import * as fs from "node:fs";
import { constants as bufferConstants } from "node:buffer";
import { appendFile, mkdtemp, open, rename, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { build } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryReader } from "../../electron/history/history-reader";
import { HistoryJobs } from "../../electron/history/history-jobs";
import { parseSessionJsonl } from "../../electron/history/session-jsonl";
import { parseSessionTree } from "../../electron/omo/session-tree";
import { readContextUsageFile } from "../../electron/workbench/context-usage";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) };
});
vi.mock("node:fs/promises", { spy: true });

const lines = (count: number): string => {
  const out = [JSON.stringify({ type: "session", version: 3, id: "s", timestamp: "2026-10-21T00:00:00Z", cwd: "/w" })];
  let parent: string | null = null;
  for (let index = 0; index < count; index += 1) {
    const user = `u${index}`, answer = `a${index}`;
    out.push(JSON.stringify({ type: "message", id: user, parentId: parent, message: { role: "user", content: [{ type: "text", text: `question ${index}` }] } }));
    out.push(JSON.stringify({ type: "message", id: answer, parentId: user, message: { role: "assistant", content: [{ type: "text", text: `answer ${index}` }], stopReason: "stop" } }));
    parent = answer;
  }
  return out.join("\n") + "\n";
};

const readers: HistoryReader[] = [];
afterEach(async () => {
  await Promise.all(readers.splice(0).map((reader) => reader.close()));
  vi.restoreAllMocks();
});

async function session(count: number): Promise<{ file: string; text: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "history-reader-"));
  const file = path.join(dir, "s.jsonl");
  const text = lines(count);
  await writeFile(file, text);
  return { file, text };
}

describe("HistoryReader", () => {
  it("defers a large tool result until that item is requested without parsing neighboring results", async () => {
    const { file } = await session(0);
    const large = "large tool result ".repeat(8_000);
    const text = [
      { type: "message", id: "u", parentId: null, message: { role: "user", content: "inspect" } },
      { type: "message", id: "a", parentId: "u", message: { role: "assistant", content: [{ type: "toolCall", id: "call", name: "read", arguments: { path: "test.log" } }] } },
      { type: "message", id: "r", parentId: "a", message: { role: "toolResult", toolCallId: "call", toolName: "read", content: [{ type: "text", text: large }] } },
    ].map(entry => JSON.stringify(entry)).join("\n") + "\n";
    await writeFile(file, text);
    const jobs = new HistoryJobs();
    const parse = vi.spyOn(JSON, "parse");

    const page = await jobs.run({ kind: "update", file, since: null, fullFrom: -1 });

    expect(parse.mock.calls.some(([source]) => source.includes(large))).toBe(false);
    expect("turns" in page && page.turns[0]?.items[1]).toMatchObject({ historyRef: { file, turnId: "u" } });
    const item = await jobs.run({ kind: "tool", file, turnId: "u", toolId: "call" });
    expect("turns" in item && item.turns[0]?.items[1]).toMatchObject({ contentItems: [{ type: "inputText", text: large }] });
    const full = await jobs.run({ kind: "full", file });
    expect("turns" in full && full.turns[0]?.items[1]).toMatchObject({ contentItems: [{ type: "inputText", text: large }] });
    const deferredAgain = await jobs.run({ kind: "update", file, since: null, fullFrom: 0 });
    expect("turns" in deferredAgain && deferredAgain.turns[0]?.items[1]).toMatchObject({ historyRef: { file, turnId: "u" } });
    expect("turns" in deferredAgain && JSON.stringify(deferredAgain.turns)).not.toContain(large);
    const fullAgain = await jobs.run({ kind: "full", file });
    expect("turns" in fullAgain && fullAgain.turns[0]?.items[1]).toMatchObject({ contentItems: [{ type: "inputText", text: large }] });
  });

  it("keeps native context provider and model when history and usage share the index", async () => {
    const { file } = await session(0);
    const text = lines(1).replace('"stopReason":"stop"', '"provider":"opencodex","model":"test-model","usage":{"input":10,"output":2,"cacheRead":30,"cacheWrite":0},"stopReason":"stop"');
    await writeFile(file, text);
    expect(await new HistoryJobs().run({ kind: "context", file })).toEqual({ tokens: 42, provider: "opencodex", model: "test-model", compacted: false });
  });

  it("keeps readable history when a completed malformed message makes only tree navigation invalid", async () => {
    const { file } = await session(1);
    const jobs = new HistoryJobs();
    await jobs.run({ kind: "update", file, since: null, fullFrom: -40 });
    await appendFile(file, '{"type":"message","id":"a2","parentId":"a0"}\n'
      + JSON.stringify({ type: "message", id: "a2b", parentId: "a0", message: { role: "assistant", content: "New terminal answer", stopReason: "stop" } }) + "\n");
    const result = await jobs.run({ kind: "update", file, since: null, fullFrom: -40 });
    expect("turns" in result && result.turns[0]?.items.at(-1)).toMatchObject({ text: "New terminal answer" });
    await expect(jobs.run({ kind: "tree", file })).rejects.toThrow("malformed get_tree");
  });

  it("keeps reordered prompts, user images and nested memory notices outside the hydrated page", async () => {
    const { file } = await session(0);
    const prompt = "long question ".repeat(400);
    const notice = { sha: "write-sha", subject: "Remember", affected: [{ path: "notes/a.md", insertions: 2, deletions: 1 }], size: { systemBytes: 10, totalBytes: 20, fileCount: 1 } };
    const text = [
      { type: "message", id: "u", parentId: null, message: { content: [{ type: "text", text: prompt }, { type: "image", data: "aGVsbG8=", mimeType: "image/png" }], role: "user" } },
      { type: "message", id: "a", parentId: "u", message: { role: "assistant", content: [{ type: "toolCall", id: "m", name: "memory", arguments: {} }] } },
      { type: "message", id: "r", parentId: "a", message: { role: "toolResult", toolName: "memory", toolCallId: "m", content: "saved", details: { writeNotice: notice } } },
      { type: "message", id: "last", parentId: "r", message: { role: "user", content: "new question" } },
    ].map(entry => JSON.stringify(entry)).join("\n") + "\n";
    await writeFile(file, text);

    const result = await new HistoryJobs().run({ kind: "update", file, since: null, fullFrom: -1 });

    expect("turns" in result && result.turns[0]?.items[0]).toMatchObject({ content: [{ type: "text", text: prompt }, { type: "image", url: "data:image/png;base64,aGVsbG8=" }] });
    expect("memoryWrites" in result && result.memoryWrites?.["m"]).toMatchObject(notice);
  });

  it("selects turn payloads before parsing and loads an older page without losing searchable prompts", async () => {
    const { file } = await session(0);
    const large = "historical payload " + "x".repeat(8_000);
    const text = lines(6).replace("answer 0", large).replace("answer 1", large + " second");
    await writeFile(file, text);
    const parse = vi.spyOn(JSON, "parse");
    const jobs = new HistoryJobs();

    const latest = await jobs.run({ kind: "update", file, since: null, fullFrom: -2 });

    expect("turns" in latest && latest.turns).toHaveLength(6);
    expect(parse.mock.calls.some(([source]) => source.includes(large))).toBe(false);
    expect("turns" in latest && latest.turns[0]?.items[0]).toMatchObject({ type: "userMessage", content: [{ type: "text", text: "question 0" }] });
    parse.mockClear();
    const page = await jobs.run({ kind: "page", file, from: 0, count: 1 });
    expect("turns" in page && page.turns.map(turn => turn.id)).toEqual(["u0"]);
    expect("turns" in page && page.turns[0]?.items[1]).toMatchObject({ type: "agentMessage", text: large });
    expect(parse.mock.calls.some(([source]) => source.includes(large + " second"))).toBe(false);
    const entry = await jobs.run({ kind: "entry", file, entryId: "a1" });
    expect("nodes" in entry && entry.nodes[0]?.text).toBe(large + " second");
  });

  it("an unchanged refresh reads no payload bytes after a page was hydrated", async () => {
    const { file } = await session(3);
    const jobs = new HistoryJobs();
    const initial = await jobs.run({ kind: "update", file, since: null, fullFrom: -2 });
    const fsp = await import("node:fs/promises");
    const original = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).open;
    let payloadBytes = 0;
    vi.spyOn(fsp, "open").mockImplementation(async (...args) => {
      const handle = await original(...args);
      const read = handle.read.bind(handle);
      handle.read = async (...input: Parameters<typeof read>) => {
        const result = await read(...input);
        payloadBytes += result.bytesRead;
        return result;
      };
      return handle;
    });
    vi.mocked(fs.createReadStream).mockClear();

    const next = await jobs.run({ kind: "update", file, since: "token" in initial ? initial.token : null, fullFrom: -2 });

    expect("turns" in next && next.turns).toEqual([]);
    expect(fs.createReadStream).not.toHaveBeenCalled();
    expect(payloadBytes).toBe(0);
  });

  it("reads only appended UTF-8 bytes and reuses the unchanged derived tree", async () => {
    const { file, text } = await session(3);
    const jobs = new HistoryJobs();
    const first = await jobs.run({ kind: "update", file, since: null, fullFrom: -2 });
    const streams = vi.mocked(fs.createReadStream);
    streams.mockClear();
    const addition = JSON.stringify({ type: "message", id: "last", parentId: "a2", message: { role: "assistant", content: "마지막", stopReason: "stop" } }) + "\n";
    await appendFile(file, addition);

    const updated = await jobs.run({ kind: "update", file, since: "token" in first ? first.token : null, fullFrom: -2 });

    expect("turns" in updated && updated.turns.at(-1)?.items.at(-1)).toMatchObject({ type: "agentMessage", text: "마지막" });
    expect(streams.mock.calls.filter(([target]) => target === file).map(([, options]) => options)).toEqual([
      expect.objectContaining({ start: Buffer.byteLength(text), end: Buffer.byteLength(text + addition) - 1 }),
    ]);
    streams.mockClear();
    expect(await jobs.run({ kind: "tree", file })).toEqual(parseSessionTree(text + addition));
    expect(streams).not.toHaveBeenCalled();
  });

  it.each(["replacement", "shrink", "mtime regression", "branch", "partial"] as const)("rebuilds derived state after %s instead of trusting a stale byte offset", async (change) => {
    const { file, text } = await session(3);
    const jobs = new HistoryJobs();
    await jobs.run({ kind: "full", file });
    let next = lines(1);
    if (change === "replacement") { await rename(file, `${file}.old`); await writeFile(file, next); }
    else if (change === "shrink") await writeFile(file, next);
    else if (change === "mtime regression") { next = lines(4); await writeFile(file, next); await utimes(file, new Date(0), new Date(0)); }
    else if (change === "branch") { next = text + JSON.stringify({ type: "message", id: "fork", parentId: "a0", message: { role: "assistant", content: "Fork answer", stopReason: "stop" } }) + "\n"; await writeFile(file, next); }
    else { await appendFile(file, '{"type":"message","id":"torn"'); await jobs.run({ kind: "full", file }); next = text + '{"type":"message","id":"torn","parentId":"a2","message":{"role":"assistant","content":"Recovered","stopReason":"stop"}}\n'; await writeFile(file, next); }
    vi.mocked(fs.createReadStream).mockClear();

    expect(await jobs.run({ kind: "full", file })).toEqual(parseSessionJsonl(next));
    expect(await jobs.run({ kind: "tree", file })).toEqual(parseSessionTree(next));
    expect(vi.mocked(fs.createReadStream).mock.calls.some(([, options]) => typeof options === "object" && options !== null && "start" in options && options.start === 0)).toBe(true);
  });

  it("parses on the worker thread exactly as in-process and sends a reread only the appended turns", async () => {
    const out = await mkdtemp(path.join(tmpdir(), "history-worker-"));
    const workerPath = path.join(out, "history-worker.cjs");
    await build({ entryPoints: [path.resolve("electron/history/history-worker.ts")], outfile: workerPath, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
    const reader = new HistoryReader(workerPath);
    readers.push(reader);
    const warn = vi.spyOn(console, "warn");
    const { file, text } = await session(5);
    expect(await reader.full(file)).toEqual(parseSessionJsonl(text));
    const first = await reader.update(file, null, -2);
    expect([first.total, first.from, first.fullFrom, first.turns.length]).toEqual([5, 0, 3, 5]);
    await writeFile(file, lines(6));
    const next = await reader.update(file, first.token, -2);
    expect([next.base, next.total, next.from, next.removed, next.turns.map((turn) => turn.id)]).toEqual([first.token, 6, 5, 0, parseSessionJsonl(lines(6)).turns.slice(5).map((turn) => turn.id)]);
    expect(await reader.tree(file)).toEqual(parseSessionTree(lines(6)));
    expect(warn).not.toHaveBeenCalled();
  });

  it("serves an open's branch tree from the history read of the same file and rereads it only after the file changes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const reader = new HistoryReader(path.join(tmpdir(), "missing-history-worker.cjs"));
    readers.push(reader);
    const { file, text } = await session(4);
    const reads = vi.mocked(fs.createReadStream);
    reads.mockClear();
    await reader.update(file, null, -2);
    expect(await reader.tree(file)).toEqual(parseSessionTree(text));
    expect(reads.mock.calls.filter(([target]) => target === file)).toHaveLength(1);
    await writeFile(file, lines(5));
    expect(await reader.tree(file)).toEqual(parseSessionTree(lines(5)));
    expect(reads.mock.calls.filter(([target]) => target === file)).toHaveLength(2);
  });

  it("reads in-process with the same results when the worker cannot start", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const reader = new HistoryReader(path.join(tmpdir(), "missing-history-worker.cjs"));
    readers.push(reader);
    const { file, text } = await session(3);
    expect(await reader.full(file)).toEqual(parseSessionJsonl(text));
    expect((await reader.update(file, null, undefined)).total).toBe(3);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("reads history and its tree when the session exceeds the runtime's single-string limit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const reader = new HistoryReader(path.join(tmpdir(), "missing-history-worker.cjs"));
    readers.push(reader);
    const { file, text } = await session(2);
    const handle = await open(file, "a");
    try {
      const blanks = Buffer.alloc(1 << 20, " ");
      blanks[blanks.length - 1] = 10;
      let padding = bufferConstants.MAX_STRING_LENGTH + 1;
      while (padding > 0) {
        const length = Math.min(padding, blanks.length);
        await handle.write(blanks, 0, length);
        padding -= length;
      }
    } finally { await handle.close(); }

    const update = await reader.update(file, null, -2);

    expect({ total: update.total, fullFrom: update.fullFrom, turns: update.turns }).toEqual({
      total: 2, fullFrom: 0, turns: parseSessionJsonl(text).turns,
    });
    expect(await reader.tree(file)).toEqual(parseSessionTree(text));
    expect(await readContextUsageFile(file)).toEqual({ tokens: null, provider: null, model: null, compacted: false });
  });

  it.each([false, true])("rejects an input stream failure after stat, afterRecords=%s", async (afterRecords) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { file, text } = await session(1);
    const failure = new Error("session read failed");
    vi.mocked(fs.createReadStream).mockImplementationOnce(() => Readable.from((async function* () {
      if (afterRecords) yield text;
      throw failure;
    })()) as fs.ReadStream);
    const reader = new HistoryReader(path.join(tmpdir(), "missing-history-worker.cjs"));
    readers.push(reader);

    await expect(reader.update(file, null, -2)).rejects.toThrow("session read failed");
  });

  it("keeps UTF-8, branch links and usage across chunk boundaries and a torn final record", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const reader = new HistoryReader(path.join(tmpdir(), "missing-history-worker.cjs"));
    readers.push(reader);
    const { file } = await session(0);
    const text = [
      { type: "session", id: "s", version: 3 },
      { type: "message", id: "u", parentId: null, message: { role: "user", content: "한국어 질문" } },
      { type: "message", id: "a", parentId: "u", message: { role: "assistant", content: [{ type: "text", text: "고양이 답변" }], provider: "fake", model: "alpha", usage: { totalTokens: 123 }, stopReason: "stop" } },
    ].map(entry => JSON.stringify(entry)).join("\r\n") + '\r\n{"type":"message","id":"partial"';
    const bytes = Buffer.from(text);
    const split = bytes.indexOf(Buffer.from("한")) + 1;
    await writeFile(file, text);
    vi.mocked(fs.createReadStream).mockImplementationOnce(() => Readable.from((async function* () {
      const decoder = new TextDecoder();
      yield decoder.decode(bytes.subarray(0, split), { stream: true });
      yield decoder.decode(bytes.subarray(split), { stream: true });
      yield decoder.decode();
    })()) as fs.ReadStream);

    const history = await reader.full(file);

    expect(history.turns[0]?.items).toEqual([
      { type: "userMessage", id: "u", clientId: null, content: [{ type: "text", text: "한국어 질문", text_elements: [] }] },
      { type: "agentMessage", id: "a:0", text: "고양이 답변", phase: null },
    ]);
    expect(await readContextUsageFile(file)).toEqual({ tokens: 123, provider: "fake", model: "alpha", compacted: false });
  });
});
