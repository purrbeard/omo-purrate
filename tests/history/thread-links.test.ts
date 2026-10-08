import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHeaderLinks } from "../../electron/history/thread-links";

vi.mock("node:fs", () => ({ createReadStream: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const root = path.resolve("/sessions/root.jsonl");
const child = path.resolve("/sessions/child.jsonl");
const grandchild = path.resolve("/sessions/grandchild.jsonl");
const header = (id: string, parentSession?: string) => JSON.stringify({ type: "session", version: 3, id, parentSession }) + "\n";
const resolve = async (file: string) => file;
function files(entries: Record<string, string>) {
  const opened: Readable[] = [];
  vi.mocked(createReadStream).mockImplementation(file => {
    const text = entries[String(file)];
    if (text === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    const input = Readable.from([text]) as ReturnType<typeof createReadStream>;
    opened.push(input);
    return input;
  });
  return opened;
}

describe("read-only native parent header links", () => {
  it("returns actual header IDs and parent chains without listed root sessions or filename guesses", async () => {
    const opened = files({ [root]: header("root-id"), [child]: header("child-id", root), [grandchild]: header("grandchild-id", child) });
    const resolver = vi.fn(resolve);
    expect(await loadHeaderLinks([grandchild, grandchild, child], resolver)).toEqual([
      { parentId: "child-id", childId: "grandchild-id", title: "grandchild-id", origin: "native" },
      { parentId: "root-id", childId: "child-id", title: "child-id", origin: "native" },
    ]);
    expect(resolver.mock.calls).toEqual([[grandchild], [child], [root]]);
    expect(opened.every(input => input.destroyed)).toBe(true);
  });

  it("reads the first header across chunks, ignoring misleading messages and transcript tails", async () => {
    const text = header("child-id", root);
    const opened = files({ [root]: header("root-id") });
    const original = vi.mocked(createReadStream).getMockImplementation()!;
    vi.mocked(createReadStream).mockImplementation((file, options) => {
      if (file !== child) return original(file, options);
      const input = Readable.from([text.slice(0, 8), text.slice(8), "{broken transcript\n"]) as ReturnType<typeof createReadStream>;
      opened.push(input);
      return input;
    });
    expect(await loadHeaderLinks([child], resolve)).toEqual([
      { parentId: "root-id", childId: "child-id", title: "child-id", origin: "native" },
    ]);
    expect(opened.every(input => input.destroyed)).toBe(true);
  });

  it.each([
    "{partial", "null\n", "[]\n", "", '{"type":"session","id":2}\n',
    '{"type":"session","id":"../unsafe"}\n', '{"type":"message","id":"child-id"}\n',
  ])("omits malformed and incomplete first headers: %s", async text => {
    files({ [child]: text + "\n" + header("child-id", root), [root]: header("root-id") });
    expect(await loadHeaderLinks([child], resolve)).toEqual([]);
  });

  it("does not infer parents from related titles, message parentId, relative paths, or nonexistent files", async () => {
    for (const text of [
      header("child-id") + JSON.stringify({ type: "session_info", name: "root-id related agent" }),
      header("child-id") + JSON.stringify({ type: "message", parentId: "root-id" }),
      header("child-id", "root.jsonl"),
      header("child-id", root),
    ]) {
      files({ [child]: text });
      expect(await loadHeaderLinks([child], resolve)).toEqual([]);
    }
    expect(await loadHeaderLinks([root], resolve)).toEqual([]);
  });

  it("terminates cyclic parent chains and omits self-links", async () => {
    files({ [child]: header("child-id", root), [root]: header("root-id", child) });
    expect(await loadHeaderLinks([child], resolve)).toHaveLength(2);
    expect(createReadStream).toHaveBeenCalledTimes(2);
    files({ [child]: header("child-id", child) });
    expect(await loadHeaderLinks([child], resolve)).toEqual([]);
  });

  it.each([child, root])("uses the same containment boundary for %s", async outside => {
    files({ [child]: header("child-id", root), [root]: header("root-id") });
    await expect(loadHeaderLinks([child], async file => {
      if (file === outside) throw new Error("outside sessions directory");
      return file;
    })).rejects.toThrow("outside sessions directory");
    expect(vi.mocked(createReadStream).mock.calls.some(([file]) => file === outside)).toBe(false);
  });

  it("tolerates a removed session but propagates read failures and closes streams", async () => {
    files({ [child]: header("child-id", root), [root]: header("root-id") });
    expect(await loadHeaderLinks([grandchild, child], async file => {
      if (file === grandchild) throw Object.assign(new Error("removed"), { code: "ENOENT" });
      return file;
    })).toHaveLength(1);
    const failed = Readable.from((async function* () { throw Object.assign(new Error("denied"), { code: "EACCES" }); })());
    vi.mocked(createReadStream).mockReturnValue(failed as ReturnType<typeof createReadStream>);
    await expect(loadHeaderLinks([child], resolve)).rejects.toThrow("denied");
    expect(failed.destroyed).toBe(true);
  });
});
