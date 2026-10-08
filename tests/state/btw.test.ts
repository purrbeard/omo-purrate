import { describe, expect, it } from "vitest";
import {
  SIDE_BACKGROUND_MARKER,
  createInitialState,
  isSideNotice,
  parseBtwCommand,
  parseStoredSides,
  reduce,
  selectPanelNotices,
  selectSidesOf,
  selectThreadsByWorkspace,
  selectUnknownThreadsByWorkspace,
  selectToastNotice,
  sideDraftKey,
  sideName,
} from "../../src/state";
import type { AppEvent, AppState, Notice, SideChat } from "../../src/state";
import { makeThread, notification } from "./helpers";

const MAIN = "main-1";
const SIDE = "side-1";
const CWD = "/tmp/work/project";

const side = (overrides: Partial<SideChat> = {}): SideChat => ({
  id: SIDE,
  parentId: MAIN,
  question: "what changed?",
  createdAtMs: 10,
  context: true,
  ...overrides,
});

function apply(state: AppState, ...events: AppEvent[]): AppState {
  return events.reduce(reduce, state);
}

function withMain(): AppState {
  return apply(createInitialState(), { type: "threads/listed", threads: [makeThread(MAIN, { cwd: CWD })], nextCursor: null, append: false });
}

function listedIds(state: AppState): string[] {
  return [...selectThreadsByWorkspace(state), ...selectUnknownThreadsByWorkspace(state)].flatMap((group) => group.threads.map((thread) => thread.id));
}

function registered(state: AppState, chat: SideChat = side()): AppState {
  return apply(state, { type: "btw/starting", cwd: CWD }, { type: "btw/started", cwd: CWD, side: chat });
}

describe("parseBtwCommand", () => {
  it("reads /btw and /side with a question in any letter case", () => {
    expect(parseBtwCommand("/btw what changed?")).toEqual({ question: "what changed?" });
    expect(parseBtwCommand("  /side   tell me more ")).toEqual({ question: "tell me more" });
    expect(parseBtwCommand("/BTW Why?")).toEqual({ question: "Why?" });
    expect(parseBtwCommand("/btw\nfirst line\nsecond line")).toEqual({ question: "first line\nsecond line" });
  });

  it("reads a bare command as an empty question", () => {
    expect(parseBtwCommand("/btw")).toEqual({ question: "" });
    expect(parseBtwCommand("  /side  ")).toEqual({ question: "" });
  });

  it("returns null for other text", () => {
    for (const text of ["/btwx", "hello /btw", "btw what", "/skill:btw now", "/sidebar"]) expect(parseBtwCommand(text)).toBeNull();
  });
});

describe("side chat names and keys", () => {
  it("names a side thread from the first line of its question, shortened to 60 characters", () => {
    expect(sideName("what changed?\nmore detail")).toBe("BTW: what changed?");
    const long = sideName("a".repeat(80));
    expect(long).toBe(`BTW: ${"a".repeat(59)}…`);
  });

  it("keys the new-side draft apart from a side chat's draft", () => {
    expect(sideDraftKey(MAIN, null)).not.toBe(sideDraftKey(MAIN, SIDE));
  });
});

describe("parseStoredSides", () => {
  it("keeps well-formed entries and drops malformed ones", () => {
    const stored: unknown = [
      side(),
      null,
      { ...side({ id: "" }) },
      { ...side({ id: "side-2" }), context: "yes" },
      { ...side({ id: "side-3" }), createdAtMs: Number.POSITIVE_INFINITY },
      { ...side({ id: "side-4" }), parentId: 7 },
    ];
    expect(parseStoredSides(stored)).toEqual([side()]);
    expect(parseStoredSides({ sides: [side()] })).toEqual([]);
  });
});

describe("side chat reducer", () => {
  it("restores stored side chats once", () => {
    const restored = apply(createInitialState(), { type: "btw/restored", sides: [side()] });
    expect(restored.btw.sides).toEqual({ [SIDE]: side() });
    expect(restored.btw.restored).toBe(true);
    expect(reduce(restored, { type: "btw/restored", sides: [side({ id: "side-2" })] })).toBe(restored);
  });

  it("keeps the state reference for unchanged panel, selection, context and draft events", () => {
    const state = createInitialState();
    expect(reduce(state, { type: "btw/toggled", open: false })).toBe(state);
    expect(reduce(state, { type: "btw/selected", parentId: MAIN, sideId: null })).toBe(state);
    expect(reduce(state, { type: "btw/contextSet", parentId: MAIN, attached: true })).toBe(state);
    expect(reduce(state, { type: "btw/draftSet", key: sideDraftKey(MAIN, null), text: "" })).toBe(state);
  });

  it("detaches and reattaches the main context and drops a cleared draft", () => {
    const key = sideDraftKey(MAIN, null);
    const detached = apply(createInitialState(), { type: "btw/contextSet", parentId: MAIN, attached: false }, { type: "btw/draftSet", key, text: "q" });
    expect(detached.btw.detached).toEqual({ [MAIN]: true });
    expect(detached.btw.drafts).toEqual({ [key]: "q" });
    const back = apply(detached, { type: "btw/contextSet", parentId: MAIN, attached: true }, { type: "btw/draftSet", key, text: "" });
    expect(back.btw.detached).toEqual({});
    expect(back.btw.drafts).toEqual({});
  });

  it("holds a thread started during a pending side start until the side chat claims it", () => {
    let state = apply(withMain(), { type: "btw/starting", cwd: CWD }, notification("thread/started", { thread: makeThread(SIDE, { cwd: CWD }) }));
    expect(state.btw.unclaimed).toEqual({ [SIDE]: CWD });
    expect(listedIds(state)).toEqual([MAIN]);
    state = reduce(state, { type: "btw/started", cwd: CWD, side: side() });
    expect(state.btw.unclaimed).toEqual({});
    expect(state.btw.pending).toEqual({});
    expect(state.btw.sides[SIDE]).toEqual(side());
    expect(state.btw.selected[MAIN]).toBe(SIDE);
    expect(listedIds(state)).toEqual([MAIN]);
  });

  it("releases a held thread that OmO UI opens as a main thread", () => {
    const thread = makeThread("main-2", { cwd: CWD });
    const held = apply(withMain(), { type: "btw/starting", cwd: CWD }, notification("thread/started", { thread }));
    expect(listedIds(held)).toEqual([MAIN]);
    const opened = reduce(held, { type: "thread/opened", thread, resumed: true });
    expect(listedIds(opened)).toContain("main-2");
  });

  it("releases threads held for a cwd when its side start fails", () => {
    const held = apply(withMain(), { type: "btw/starting", cwd: CWD }, notification("thread/started", { thread: makeThread("stray", { cwd: CWD }) }));
    const failed = reduce(held, { type: "btw/started", cwd: CWD, side: null });
    expect(failed.btw.unclaimed).toEqual({});
    expect(failed.btw.pending).toEqual({});
    expect(listedIds(failed)).toContain("stray");
  });

  it("hides a thread whose preview carries the side chat marker even without a registry entry", () => {
    const state = apply(withMain(), {
      type: "threads/listed",
      threads: [makeThread(MAIN, { cwd: CWD }), makeThread("orphan", { cwd: CWD, preview: `${SIDE_BACKGROUND_MARKER}\nMain thread: x` })],
      nextCursor: null,
      append: false,
    });
    expect(listedIds(state)).toEqual([MAIN]);
  });

  it("forgets a deleted side chat and returns its main thread to the new-side composer", () => {
    const withDraft = apply(registered(withMain()), { type: "btw/draftSet", key: sideDraftKey(MAIN, SIDE), text: "follow up" });
    const deleted = reduce(withDraft, notification("thread/deleted", { threadId: SIDE }));
    expect(deleted.btw.sides).toEqual({});
    expect(deleted.btw.selected[MAIN]).toBeNull();
    expect(deleted.btw.drafts).toEqual({});
  });

  it("drops a deleted main thread's selection, detach flag and new-side draft but keeps its side chats", () => {
    const state = apply(
      registered(withMain()),
      { type: "btw/contextSet", parentId: MAIN, attached: false },
      { type: "btw/draftSet", key: sideDraftKey(MAIN, null), text: "q" },
      notification("thread/deleted", { threadId: MAIN }),
    );
    expect(state.btw.selected).toEqual({});
    expect(state.btw.detached).toEqual({});
    expect(state.btw.drafts).toEqual({});
    expect(state.btw.sides[SIDE]).toEqual(side());
  });
});

describe("side chat selectors", () => {
  it("lists a main thread's side chats oldest first with a stable reference", () => {
    const state = registered(registered(withMain(), side({ id: "side-b", createdAtMs: 20 })), side({ id: "side-a", createdAtMs: 10 }));
    const sides = selectSidesOf(state, MAIN);
    expect(sides.map((chat) => chat.id)).toEqual(["side-a", "side-b"]);
    expect(selectSidesOf(state, MAIN)).toBe(sides);
    expect(selectSidesOf(state, "other")).toEqual([]);
    expect(selectSidesOf(state, null)).toEqual([]);
  });

  it("routes side chat notices to the panel and the rest to the toast queue", () => {
    const sideNotice: Notice = { id: "n-side", level: "error", message: "side failed", threadId: SIDE };
    const startNotice: Notice = { id: "n-start", level: "error", message: "start failed", threadId: MAIN, scope: "side" };
    const mainNotice: Notice = { id: "n-main", level: "error", message: "main failed", threadId: MAIN };
    const state = apply(
      registered(withMain()),
      { type: "notice/pushed", notice: sideNotice },
      { type: "notice/pushed", notice: startNotice },
      { type: "notice/pushed", notice: mainNotice },
    );
    expect(isSideNotice(state, sideNotice)).toBe(true);
    expect(isSideNotice(state, startNotice)).toBe(true);
    expect(isSideNotice(state, mainNotice)).toBe(false);
    expect(selectToastNotice(state)).toEqual(mainNotice);
    expect(selectPanelNotices(state, MAIN, SIDE)).toEqual([sideNotice]);
    const fresh = selectPanelNotices(state, MAIN, null);
    expect(fresh).toEqual([startNotice]);
    expect(selectPanelNotices(state, MAIN, null)).toBe(fresh);
    expect(selectPanelNotices(state, null, null)).toEqual([]);
  });
});
