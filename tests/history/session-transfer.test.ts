import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { quarantineSync } from "../../scripts/quarantine-temp.mjs";
import { exportSessionJsonl, importSessionJsonl } from "../../electron/history/session-transfer";
import { parseSessionJsonl } from "../../electron/history/session-jsonl";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) quarantineSync(root, { recursive: true, force: true }); });
const timestamp = "2026-11-01T00:00:00.000Z";
const header = { type: "session", version: 3, id: "custom-sdk-id", timestamp, cwd: path.resolve("/work/project") };
const entries = [
  { type: "message", id: "u", parentId: null, message: { role: "user", content: [{ type: "text", text: "hello" }, { type: "image", data: "AQID", mimeType: "image/png" }] } },
  { type: "message", id: "a", parentId: "u", message: { role: "assistant", content: [{ type: "text", text: "first" }] } },
  { type: "message", id: "b", parentId: "u", message: { role: "assistant", content: [{ type: "text", text: "alternate" }] } },
];
const jsonl = (values: object[]) => values.map(value => JSON.stringify(value)).join("\r\n") + "\r\n";

async function fixture(text = jsonl([header, ...entries])) {
  const root = await mkdtemp(path.join(tmpdir(), "purrate-transfer-"));
  roots.push(root);
  const source = path.join(root, "source.jsonl");
  const sessions = path.join(root, "sessions");
  await mkdir(sessions);
  await writeFile(source, text);
  return { root, source, sessions, text };
}

describe("local native JSONL transfer", () => {
  it("exports exact bytes and refuses to overwrite an existing destination", async () => {
    const f = await fixture();
    const target = path.join(f.root, "export.jsonl");
    await exportSessionJsonl(f.source, target);
    expect(await readFile(target, "utf8")).toBe(f.text);
    await expect(exportSessionJsonl(f.source, target)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(f.source, "utf8")).toBe(f.text);
  });

  it("imports each copy with a fresh header identity, preserving branch and image entry bytes", async () => {
    const f = await fixture();
    const first = await importSessionJsonl(f.source, f.sessions);
    const second = await importSessionJsonl(f.source, f.sessions);
    expect(first.threadId).not.toBe(header.id);
    expect(second.threadId).not.toBe(first.threadId);
    const imported = await readFile(first.path, "utf8");
    const end = imported.indexOf("\n");
    expect(JSON.parse(imported.slice(0, end))).toEqual({ ...header, id: first.threadId, timestamp: expect.any(String), parentSession: f.source });
    expect(imported.slice(end + 1)).toBe(f.text.slice(f.text.indexOf("\n") + 1));
    expect(await readFile(f.source, "utf8")).toBe(f.text);
  });

  it.each([
    ["empty", ""],
    ["malformed line", jsonl([header, entries[0] ?? {}]) + "{broken\n"],
    ["newer harness format", jsonl([{ ...header, version: 4 }])],
    ["relative cwd", jsonl([{ ...header, cwd: "relative" }])],
    ["invalid timestamp", jsonl([{ ...header, timestamp: "invalid" }])],
    ["duplicate entry", jsonl([header, ...entries, entries[1] ?? {}])],
    ["missing parent", jsonl([header, { type: "message", id: "x", parentId: "absent" }])],
    ["missing entry id", jsonl([header, { type: "message", parentId: null }])],
  ])("rejects %s before creating an import", async (_name, text) => {
    const f = await fixture(text);
    await expect(importSessionJsonl(f.source, f.sessions)).rejects.toThrow();
    expect(await readdir(f.sessions)).toEqual([]);
    expect(await readFile(f.source, "utf8")).toBe(text);
  });

  it("migrates a legacy copy into a tree readable by the actual history consumer", async () => {
    const legacy = jsonl([{ ...header, version: 1 }, { type: "message", message: { role: "user", content: "legacy" } }, { type: "message", message: { role: "assistant", content: [{ type: "text", text: "legacy reply" }] } }]);
    const f = await fixture(legacy);
    const saved = await importSessionJsonl(f.source, f.sessions);
    const imported = await readFile(saved.path, "utf8");
    expect(JSON.parse(imported.split("\n")[0] ?? "{}").version).toBe(2);
    expect(parseSessionJsonl(imported).turns[0]?.items[0]).toMatchObject({ type: "userMessage", content: [{ type: "text", text: "legacy" }] });
    expect(parseSessionJsonl(imported).turns[0]?.items[1]).toMatchObject({ type: "agentMessage", text: "legacy reply" });
    expect(await readFile(f.source, "utf8")).toBe(legacy);
  });

  it("rejects invalid UTF-8 before copying or creating an imported session", async () => {
    const f = await fixture();
    const damaged = Buffer.concat([Buffer.from(jsonl([header]) + '{"type":"message","id":"u","parentId":null,"text":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}\n')]);
    await writeFile(f.source, damaged);
    await expect(importSessionJsonl(f.source, f.sessions)).rejects.toThrow();
    await expect(exportSessionJsonl(f.source, path.join(f.root, "export.jsonl"))).rejects.toThrow();
    expect(await readdir(f.sessions)).toEqual([]);
    expect(await readFile(f.source)).toEqual(damaged);
    expect(await readdir(f.root)).toEqual(["sessions", "source.jsonl"]);
  });
});
