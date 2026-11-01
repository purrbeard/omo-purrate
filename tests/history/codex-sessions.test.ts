import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { quarantineSync } from "../../scripts/quarantine-temp.mjs";
import { codexHomeDir, discoveredRollout, listCodexSessions, plainCwd, readRolloutHead } from "../../electron/history/codex-sessions";
import { importCodexRollout, previewCodexRollout } from "../../electron/history/codex-import";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) quarantineSync(root, { recursive: true, force: true }); });

const at = "2026-11-01T00:00:00.000Z";
const meta = (id: string, cwd: string, extra: object = {}) => ({ timestamp: at, type: "session_meta", payload: { id, cwd, timestamp: at, model_provider: "openai", ...extra } });
const injected = { timestamp: at, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n<cwd>x</cwd>" }] } };
const said = (text: string) => ({ timestamp: at, type: "event_msg", payload: { type: "user_message", message: text } });
const asked = (text: string) => ({ timestamp: at, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
const jsonl = (rows: readonly object[]) => rows.map(row => JSON.stringify(row)).join("\n") + "\n";

async function home() {
  const root = await fs.mkdtemp(path.join(tmpdir(), "purrate-codex-home-"));
  roots.push(root);
  const codex = path.join(root, ".codex"), sessions = path.join(root, "omo-sessions");
  await fs.mkdir(path.join(codex, "sessions", "2026", "11", "01"), { recursive: true });
  await fs.mkdir(path.join(codex, "archived_sessions"), { recursive: true });
  await fs.mkdir(sessions);
  return { root, codex, sessions };
}
async function rollout(codex: string, name: string, rows: readonly object[], mtime: number, folder = path.join("sessions", "2026", "11", "01")) {
  const file = path.join(codex, folder, `rollout-${name}.jsonl`);
  await fs.writeFile(file, jsonl(rows));
  await fs.utimes(file, mtime, mtime);
  return file;
}

describe("Codex session discovery", () => {
  it("uses CODEX_HOME when set and ~/.codex otherwise", () => {
    expect(codexHomeDir({ CODEX_HOME: "/custom/codex" }, "/home/u")).toBe(path.resolve("/custom/codex"));
    expect(codexHomeDir({ CODEX_HOME: "  " }, "/home/u")).toBe(path.join("/home/u", ".codex"));
    expect(codexHomeDir({}, "/home/u")).toBe(path.join("/home/u", ".codex"));
  });

  it("strips the Windows extended-length prefix from cwd", () => {
    expect(plainCwd("\\\\?\\P:\\coding\\liftingapp")).toBe("P:\\coding\\liftingapp");
    expect(plainCwd("\\\\?\\UNC\\server\\share\\x")).toBe("\\\\server\\share\\x");
    expect(plainCwd("/home/u/project")).toBe("/home/u/project");
  });

  it("lists project folder and session name newest first, from the index, the first real prompt, or the date", async () => {
    const h = await home();
    await rollout(h.codex, "a", [meta("id-named", "\\\\?\\P:\\coding\\liftingapp"), injected, said("ignored because indexed")], 1_000);
    await rollout(h.codex, "b", [meta("id-prompt", "/work/omo-ui/"), injected, said("  Fix the composer\nsecond line")], 3_000);
    await rollout(h.codex, "c", [meta("id-empty", "/work/empty"), injected], 2_000, "archived_sessions");
    await rollout(h.codex, "d", [meta("id-fallback", "/work/old"), injected, asked("Older format prompt")], 500);
    await fs.writeFile(path.join(h.codex, "session_index.jsonl"), jsonl([{ id: "id-named", thread_name: "Old name" }, { id: "id-named", thread_name: "Lifting review" }]));
    const list = await listCodexSessions(h.codex, h.sessions);
    expect(list.root).toBe(h.codex);
    expect(list.items.map(item => [item.sourceId, item.project, item.title, item.titleSource])).toEqual([
      ["id-prompt", "omo-ui", "Fix the composer", "prompt"],
      ["id-empty", "empty", null, "date"],
      ["id-named", "liftingapp", "Lifting review", "codex"],
      ["id-fallback", "old", "Older format prompt", "prompt"],
    ]);
    expect(list.items[2]?.cwd).toBe("P:\\coding\\liftingapp");
    expect(list.items[1]?.startedAt).toBe(at);
  });

  it("reads only the head of a large rollout", async () => {
    const h = await home();
    const filler = { timestamp: at, type: "event_msg", payload: { type: "token_count", pad: "x".repeat(4096) } };
    const file = await rollout(h.codex, "big", [meta("id-big", "/work/big"), ...Array.from({ length: 64 }, () => filler), said("too late")], 1_000);
    expect((await readRolloutHead(file, 16 * 1024)).prompt).toBeNull();
    expect((await readRolloutHead(file)).prompt).toBe("too late");
  });

  it("marks rollouts already imported as native sessions and leaves the source unchanged", async () => {
    const h = await home();
    const cwd = path.join(h.root, "project");
    await fs.mkdir(cwd);
    const source = await rollout(h.codex, "x", [meta("id-x", cwd), asked("hello"), { timestamp: at, type: "turn_context", payload: { model: "gpt" } }], 1_000);
    await rollout(h.codex, "y", [meta("id-y", cwd), said("other")], 2_000);
    const before = await fs.readFile(source);
    const preview = await previewCodexRollout(source);
    await importCodexRollout(source, h.sessions, { cwd, provider: "p", model: "m", previewFingerprint: preview.fingerprint });
    const list = await listCodexSessions(h.codex, h.sessions);
    expect(list.items.map(item => [item.sourceId, item.imported])).toEqual([["id-y", false], ["id-x", true]]);
    expect(await fs.readFile(source)).toEqual(before);
  });

  it("accepts preview paths only inside the Codex sessions folders", async () => {
    const h = await home();
    const inside = await rollout(h.codex, "in", [meta("id-in", "/w")], 1_000);
    const archived = await rollout(h.codex, "arc", [meta("id-arc", "/w")], 1_000, "archived_sessions");
    const outside = path.join(h.root, "rollout-out.jsonl");
    await fs.writeFile(outside, jsonl([meta("id-out", "/w")]));
    expect(await discoveredRollout(h.codex, inside)).toBe(await fs.realpath(inside));
    expect(await discoveredRollout(h.codex, archived)).toBe(await fs.realpath(archived));
    await expect(discoveredRollout(h.codex, outside)).rejects.toThrow(/outside/);
    await expect(discoveredRollout(h.codex, path.join(h.codex, "sessions", "..", "config.toml"))).rejects.toThrow(/Not a Codex rollout/);
  });

  it("returns an empty list when Codex was never used", async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), "purrate-codex-none-"));
    roots.push(root);
    expect(await listCodexSessions(path.join(root, ".codex"), path.join(root, "sessions"))).toEqual({ root: path.join(root, ".codex"), items: [], omitted: 0 });
  });
});
