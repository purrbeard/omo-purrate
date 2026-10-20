import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importPage, keysetPage, toCandidate } from "../../electron/history/session-catalog";
import { SessionIndex } from "../../electron/omo/native/threads";
import { alphaSessionRoots } from "../../electron/omo/native/alpha-sessions";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const places = { homeDir: path.resolve("/home/owner"), tmpDir: path.resolve("/scratch/tmp") };
const project = path.resolve("/work/project");
let sequence = 0;

function store() {
  const root = mkdtempSync(path.join(tmpdir(), "omo-ui-catalog-"));
  roots.push(root);
  const sessions = path.join(root, "sessions");
  mkdirSync(path.join(sessions, "--work-project--"), { recursive: true });
  return { sessions, index: new SessionIndex(sessions) };
}

const user = (text: string) => ({ type: "message", message: { role: "user", content: [{ type: "text", text }] } });
const admission = (clientMessageId: string, id: string) => ({ type: "custom", customType: "rpc_client_message_admission", data: { clientMessageId, durableSessionId: id } });

function session(sessions: string, entries: object[], options: { cwd?: string; mtimeMs?: number; header?: object; raw?: string } = {}) {
  sequence += 1;
  const id = `0190f0c0-0000-7000-8000-${String(sequence).padStart(12, "0")}`;
  const file = path.join(sessions, "--work-project--", `${sequence}_${id}.jsonl`);
  let parentId: string | null = null;
  const lines = [{ type: "session", version: 3, id, timestamp: new Date(0).toISOString(), cwd: options.cwd ?? project, ...options.header }];
  for (const [position, entry] of entries.map(entry => typeof entry === "function" ? (entry as (id: string) => object)(id) : entry).entries()) {
    const entryId = `e${sequence}-${position}`;
    lines.push({ ...entry, id: entryId, parentId } as never);
    parentId = entryId;
  }
  writeFileSync(file, lines.map(line => JSON.stringify(line)).join("\n") + "\n" + (options.raw ?? ""));
  const at = new Date(options.mtimeMs ?? 1_000_000 + sequence * 1000);
  utimesSync(file, at, at);
  return { id, file };
}

describe("first-run import classification", () => {
  it("selects only sessions a person opened in an ordinary folder", async () => {
    const { sessions, index } = store();
    const app = session(sessions, [{ type: "custom", customType: "omo-ui.origin", data: { createdBy: "omo-ui" } }, (id: string) => admission(`omo-ui:${"a".repeat(8)}-aaaa-4aaa-8aaa-${"a".repeat(12)}`, id), user("hello")]);
    const terminal = session(sessions, [user("typed in the TUI")]);
    const dori = session(sessions, [(id: string) => admission("discord:155727658920", id), user("from Discord")]);
    const team = session(sessions, [user("You are 'skeptic', a member of team 'ulw-research' running")]);
    const side = session(sessions, [user("[OmO UI side chat background]\nBelow is recent context")]);
    const child = session(sessions, [user("Reply with exactly: pong")], { header: { parentSession: "/elsewhere/parent.jsonl" } });
    const other = session(sessions, [(id: string) => admission("4f1c0e5e-1f1f-4f1f-8f1f-1f1f1f1f1f1f", id), user("another client")]);
    const empty = session(sessions, [{ type: "model_change", provider: "p", modelId: "m" }]);
    const temp = session(sessions, [user("fixture")], { cwd: path.join(places.tmpDir, "omo-ui-real-native", "run1") });
    const quarantine = session(sessions, [user("probe")], { cwd: path.resolve("/work/_quarantine/probe") });
    const hidden = session(sessions, [user("runtime")], { cwd: path.join(places.homeDir, ".dori", "runtime") });
    const byId = new Map((await index.list()).map(record => [record.id, toCandidate(record, places)]));
    const pick = (entry: { id: string }) => byId.get(entry.id)!;
    expect([app, terminal].map(entry => [pick(entry).evidence, pick(entry).recommended])).toEqual([["app", true], ["terminal", true]]);
    for (const entry of [dori, team]) expect([pick(entry).evidence, pick(entry).recommended]).toEqual(["automation", false]);
    for (const entry of [side, child]) expect([pick(entry).evidence, pick(entry).recommended]).toEqual(["child", false]);
    expect([pick(other).evidence, pick(other).recommended]).toEqual(["other-client", false]);
    expect([pick(empty).evidence, pick(empty).importable]).toEqual(["empty", false]);
    expect([temp, quarantine, hidden].map(entry => [pick(entry).location, pick(entry).importable, pick(entry).recommended]))
      .toEqual([["temp", true, false], ["quarantine", true, false], ["hidden", true, false]]);
  });

  it.each([
    ["malformed_line", { raw: "{not json\n" }, [user("hi")]],
    ["unknown_parent", {}, [user("hi"), { type: "message", message: { role: "assistant", content: [] }, parentId: "missing" }]],
    ["unsupported_version", { header: { version: 4 } }, [user("hi")]],
  ] as const)("refuses a session with a %s defect", async (defect, options, entries) => {
    const { sessions, index } = store();
    const written = session(sessions, [...entries], options);
    if (defect === "unknown_parent") {
      const lines = (await import("node:fs")).readFileSync(written.file, "utf8").trimEnd().split("\n");
      lines[lines.length - 1] = JSON.stringify({ ...JSON.parse(lines.at(-1)!), parentId: "missing" });
      writeFileSync(written.file, lines.join("\n") + "\n");
    }
    if (defect === "malformed_line") writeFileSync(written.file, (await import("node:fs")).readFileSync(written.file, "utf8") + JSON.stringify({ ...user("after"), id: "z", parentId: null }) + "\n");
    const [record] = await index.list();
    const candidate = toCandidate(record!, places);
    expect(candidate.defects).toContain(defect);
    expect([candidate.importable, candidate.recommended]).toEqual([false, false]);
  });

  it("does not report a partial last line written by a live session as damage", async () => {
    const { sessions, index } = store();
    session(sessions, [user("hi")], { raw: "{\"type\":\"mess" });
    const [record] = await index.list();
    expect(record!.facts.defects).toEqual([]);
  });

  it("recommends a session started in OmO (Alpha) and keeps an automated one out of the default selection", async () => {
    const { sessions } = store();
    const alpha = path.join(path.dirname(sessions), "omo-sessions");
    mkdirSync(path.join(alpha, "--work-project--"), { recursive: true });
    const started = session(alpha, [(id: string) => admission("4f1c0e5e-1f1f-4f1f-8f1f-1f1f1f1f1f1f", id), user("make an intro")]);
    const driven = session(alpha, [(id: string) => admission("discord:155727658920", id), user("from Discord")]);
    const index = new SessionIndex(sessions, () => [alpha]);
    const byId = new Map((await index.list()).map(record => [record.id, toCandidate(record, places)]));
    expect([byId.get(started.id)!.evidence, byId.get(started.id)!.recommended]).toEqual(["alpha", true]);
    expect([byId.get(driven.id)!.evidence, byId.get(driven.id)!.recommended]).toEqual(["automation", false]);
  });

  it("lists every non-empty session once and only counts the empty ones", async () => {
    const { sessions, index } = store();
    const kept = [session(sessions, [user("one")]), session(sessions, [user("two")])];
    session(sessions, []);
    const page = await importPage(index, null, 10, places);
    expect(page.items.map(item => item.id).sort()).toEqual(kept.map(entry => entry.id).sort());
    expect(page.emptyCount).toBe(1);
    expect(page.nextCursor).toBeNull();
  });
});

describe("OmO (Alpha) session stores", () => {
  function home() {
    const root = mkdtempSync(path.join(tmpdir(), "omo-ui-alpha-home-"));
    roots.push(root);
    return root;
  }

  it("reads Alpha's default home, follows its data-home pointer, and stays off for isolated QA", () => {
    const homeDir = home();
    expect(alphaSessionRoots(homeDir, {})).toEqual([path.join(homeDir, ".omo", "desktop", "userdata", "omo-sessions")]);
    const moved = path.join(homeDir, "elsewhere");
    mkdirSync(path.join(homeDir, ".omo", "desktop"), { recursive: true });
    writeFileSync(path.join(homeDir, ".omo", "desktop", "omo-data-home.json"), JSON.stringify({ kind: "omo-desktop-data-home-pointer", path: moved }));
    expect(alphaSessionRoots(homeDir, {})).toEqual([path.join(moved, "userdata", "omo-sessions")]);
    expect(alphaSessionRoots(homeDir, { OMO_UI_QA_AGENT_DIR: path.join(homeDir, "qa") })).toEqual([]);
    expect(alphaSessionRoots(homeDir, { OMO_UI_QA_AGENT_DIR: path.join(homeDir, "qa"), OMO_UI_ALPHA_HOME: moved })).toEqual([path.join(moved, "userdata", "omo-sessions")]);
    expect(alphaSessionRoots(homeDir, { OMO_UI_ALPHA_HOME: "" })).toEqual([]);
  });
});

describe("keyset paging", () => {
  it("never loses a session that moved to the top while later pages were read", async () => {
    const { sessions, index } = store();
    const written = Array.from({ length: 6 }, (_, position) => session(sessions, [user(`s${position}`)], { mtimeMs: 1_000_000 + position * 1000 }));
    const seen = new Set<string>();
    const first = keysetPage(await index.list(), null, 2, 2_000_000);
    first.page.forEach(record => seen.add(record.id));
    // A not-yet-read session is renamed: its mtime jumps above every cursor position.
    const renamed = written[0]!;
    utimesSync(renamed.file, new Date(2_500_000), new Date(2_500_000));
    let cursor = first.nextCursor;
    while (cursor !== null) {
      const next = keysetPage(await index.list(), cursor, 2, 3_000_000);
      next.page.forEach(record => seen.add(record.id));
      cursor = next.nextCursor;
    }
    expect([...seen].sort()).toEqual(written.map(entry => entry.id).sort());
  });

  it("orders equal times by path so a cursor between them is exact", () => {
    const record = (sessionPath: string) => ({ id: sessionPath, sessionPath, updatedAtMs: 5 }) as never;
    const all = [record("/b"), record("/a"), record("/c")];
    const first = keysetPage(all, null, 1, 10);
    const second = keysetPage(all, first.nextCursor, 1, 10);
    const third = keysetPage(all, second.nextCursor, 1, 10);
    expect([first, second, third].map(page => (page.page[0] as unknown as { id: string }).id)).toEqual(["/a", "/b", "/c"]);
    expect(third.nextCursor).toBeNull();
  });
});
