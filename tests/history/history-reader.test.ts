import * as fs from "node:fs";
import { constants as bufferConstants } from "node:buffer";
import { mkdtemp, open, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { build } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryReader } from "../../electron/history/history-reader";
import { parseSessionJsonl } from "../../electron/history/session-jsonl";
import { parseSessionTree } from "../../electron/omo/session-tree";
import { readContextUsageFile } from "../../electron/workbench/context-usage";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) };
});

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
    await writeFile(file, text);
    expect(await readContextUsageFile(file)).toEqual({ tokens: 123, provider: "fake", model: "alpha", compacted: false });
  });
});
