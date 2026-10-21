import * as fsPromises from "node:fs/promises";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryReader } from "../../electron/history/history-reader";
import { parseSessionJsonl } from "../../electron/history/session-jsonl";
import { parseSessionTree } from "../../electron/omo/session-tree";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
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
    const reads = vi.mocked(fsPromises.readFile);
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
});
