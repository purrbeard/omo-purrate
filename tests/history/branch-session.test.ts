import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { branchSession, branchSessionText, userMessageText, uuidv7 } from "../../electron/history/branch-session";

const header = { type: "session", version: 3, id: "source", timestamp: "2026-10-05T00:00:00.000Z", cwd: "/work", parentSession: "/older.jsonl" };
const user = (id: string, parentId: string | null, text: string) => ({ type: "message", id, parentId, message: { role: "user", content: [{ type: "text", text }] } });
const assistant = (id: string, parentId: string) => ({ type: "message", id, parentId, message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
const jsonl = (...lines: object[]) => lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
const NOW = new Date("2026-10-06T01:02:03.456Z");

function parse(text: string): Array<Record<string, unknown>> {
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("branchSessionText", () => {
  const source = jsonl(
    header,
    user("u1", null, "again"),
    assistant("a1", "u1"),
    { type: "label", id: "l1", parentId: "a1", targetId: "u1", label: "keep" },
    user("u2", "l1", "again"),
    assistant("a2", "u2"),
    user("u3", "a2", "third"),
  );

  it("keeps the active branch before the chosen repeat, drops labels and re-chains parentId", () => {
    const lines = parse(branchSessionText(source, "/s/source.jsonl", { text: "again", occurrence: 1 }, "new-id", NOW));
    expect(lines[0]).toEqual({ ...header, id: "new-id", timestamp: NOW.toISOString(), parentSession: "/s/source.jsonl" });
    expect(lines.slice(1).map((line) => [line["id"], line["parentId"]])).toEqual([["u1", null], ["a1", "u1"]]);
  });

  it("writes only the header when branching before the first message", () => {
    const lines = parse(branchSessionText(source, "/s/source.jsonl", { text: "again", occurrence: 0 }, "new-id", NOW));
    expect(lines).toHaveLength(1);
  });

  it("follows the last entry's branch, not abandoned siblings", () => {
    const forked = source + jsonl(user("x1", "a1", "third"));
    expect(() => branchSessionText(forked, "/s", { text: "again", occurrence: 1 }, "n", NOW)).toThrow(/not in this session/);
    const lines = parse(branchSessionText(forked, "/s", { text: "third", occurrence: 0 }, "n", NOW));
    expect(lines.slice(1).map((line) => line["id"])).toEqual(["u1", "a1"]);
  });

  it("ignores a partially written last line", () => {
    const lines = parse(branchSessionText(source + '{"type":"mess', "/s", { text: "third", occurrence: 0 }, "n", NOW));
    expect(lines.slice(1).map((line) => line["id"])).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("refuses a file without a session header or without the message", () => {
    expect(() => branchSessionText(jsonl(user("u1", null, "a")), "/s", { text: "a", occurrence: 0 }, "n", NOW)).toThrow(/header/);
    expect(() => branchSessionText(source, "/s", { text: "again", occurrence: 2 }, "n", NOW)).toThrow(/not in this session/);
  });
});

describe("userMessageText and uuidv7", () => {
  it("joins text blocks and skips images", () => {
    expect(userMessageText([{ type: "text", text: "a" }, { type: "image", data: "x" }, { type: "text", text: "b" }])).toBe("a\nb");
    expect(userMessageText("plain")).toBe("plain");
  });

  it("formats a version 7 UUID whose prefix is the millisecond timestamp", () => {
    const id = uuidv7(NOW.getTime());
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16)).toBe(NOW.getTime());
  });
});

describe("branchSession", () => {
  let dir = "";
  afterEach(async () => {
    if (dir !== "") await rm(dir, { recursive: true, force: true });
  });

  it("writes the branch beside the source under omo's file name and leaves the source unchanged", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "omo-ui-branch-"));
    const sourcePath = path.join(dir, "source.jsonl");
    const source = jsonl(header, user("u1", null, "one"), assistant("a1", "u1"), user("u2", "a1", "two"));
    await writeFile(sourcePath, source);
    const result = await branchSession(sourcePath, { text: "two", occurrence: 0 }, NOW);
    expect(path.basename(result.path)).toBe(`2026-10-06T01-02-03-456Z_${result.threadId}.jsonl`);
    expect((await readdir(dir)).sort()).toEqual([path.basename(result.path), "source.jsonl"].sort());
    expect(parse(await readFile(result.path, "utf8")).map((line) => line["id"])).toEqual([result.threadId, "u1", "a1"]);
    expect(await readFile(sourcePath, "utf8")).toBe(source);
  });
});
