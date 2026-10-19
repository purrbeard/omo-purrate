import { describe, expect, it } from "vitest";
import { createInitialState, reduce } from "../../src/state";
import { isModel, isSkill, isThread, parseItem, parseNotification } from "../../src/state/wire";
import { makeThread } from "./helpers";

const started = (item: unknown) => ({ method: "item/started", params: { threadId: "T", turnId: "turn-1", item } });

it("validates storage-only restore notifications and invalidates the inventory", () => {
  const notification = { method: "thread/unarchived", params: { threadId: "restored" } };
  expect(parseNotification(notification)).toEqual(notification);
  expect(parseNotification({ method: "thread/unarchived", params: { threadId: 42 } })).toBeNull();
  const state = createInitialState();
  state.threadsLoaded = true;
  const next = reduce(state, { type: "rpc/notification", notification, receivedAtMs: 1 });
  expect(next.threadsLoaded).toBe(false);
  expect(next.conversations["restored"]).toBeUndefined();
});

describe("wire item validation", () => {
  it.each([
    ["a userMessage with a null part", { type: "userMessage", id: "m", content: [null] }],
    ["a userMessage text part without text", { type: "userMessage", id: "m", content: [{ type: "text", text: 5 }] }],
    ["a userMessage with a numeric clientId", { type: "userMessage", id: "m", content: [], clientId: 1 }],
    ["reasoning with a non-string summary", { type: "reasoning", id: "r", summary: [null], content: [] }],
    ["a plan without text", { type: "plan", id: "p" }],
    ["a commandExecution without a command", { type: "commandExecution", id: "c", aggregatedOutput: null }],
    ["a commandExecution with numeric output", { type: "commandExecution", id: "c", command: "ls", aggregatedOutput: 3 }],
    ["a fileChange with a null change", { type: "fileChange", id: "f", changes: [null] }],
    ["a fileChange without the required diff", { type: "fileChange", id: "f", changes: [{ path: "src/main.ts", kind: { type: "update" } }] }],
    ["an mcpToolCall with a malformed error", { type: "mcpToolCall", id: "t", server: "s", tool: "x", error: { message: 1 } }],
    ["a dynamicToolCall with a null content item", { type: "dynamicToolCall", id: "d", tool: "eval", contentItems: [null] }],
    ["a dynamicToolCall inputText without text", { type: "dynamicToolCall", id: "d", tool: "eval", contentItems: [{ type: "inputText" }] }],
    ["a webSearch without a query", { type: "webSearch", id: "w" }],
  ])("rejects %s before it reaches the reducer", (_label, item) => {
    expect(parseItem(item)).toBeNull();
    const notification = started(item);
    expect(parseNotification(notification)).toBeNull();
    const state = createInitialState();
    expect(reduce(state, { type: "rpc/notification", notification, receivedAtMs: 1 })).toBe(state);
  });

  it("keeps the item shapes the installed omo emits", () => {
    const items = [
      { type: "userMessage", id: "u", clientId: null, content: [{ type: "text", text: "Reply with exactly: pong", text_elements: [] }] },
      { type: "agentMessage", id: "a", text: "pong", phase: null, memoryCitation: null },
      { type: "reasoning", id: "r", summary: [], content: ["thinking"] },
      { type: "dynamicToolCall", id: "d", namespace: null, tool: "eval", arguments: {}, status: "inProgress", contentItems: null, success: null, durationMs: null },
      { type: "dynamicToolCall", id: "d", namespace: null, tool: "eval", arguments: {}, status: "completed", contentItems: [{ type: "inputText", text: "ok" }], success: true, durationMs: null },
    ];
    for (const item of items) expect(parseItem(item)).toEqual(item);
  });

  it("drops a malformed item inside a completed turn and keeps the turn", () => {
    const turn = { id: "turn-1", status: "completed", error: null, items: [null, { type: "userMessage", id: "m", content: [null] }, { type: "agentMessage", id: "a", text: "pong" }] };
    const state = reduce(createInitialState(), { type: "rpc/notification", notification: { method: "turn/completed", params: { threadId: "T", turn } }, receivedAtMs: 1 });
    expect(state.conversations["T"]?.turns[0]?.items.map((entry) => entry.item.id)).toEqual(["a"]);
  });
});

describe("result validation", () => {
  it("accepts the thread, model and skill fields the installed omo returns", () => {
    expect(isThread(makeThread("T"))).toBe(true);
    expect(isModel({
      id: "anthropic/claude-fable-5", model: "claude-fable-5", displayName: "Claude Fable 5", description: "", hidden: false,
      supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "" }], defaultReasoningEffort: "medium", isDefault: false,
    })).toBe(true);
    expect(isSkill({ name: "ulw-loop", description: "Run a goal-driven loop.", path: "/skills/ulw-loop/SKILL.md", scope: "system", enabled: true })).toBe(true);
  });

  it("rejects entries whose consumed fields are missing or mistyped", () => {
    expect(isThread({ id: "T", cwd: "/tmp" })).toBe(false);
    expect(isModel({ id: "m", displayName: "M", description: "", supportedReasoningEfforts: [null] })).toBe(false);
    expect(isSkill({ name: "x", description: "d", scope: "user", enabled: "yes" })).toBe(false);
    expect(isSkill(null)).toBe(false);
    expect(isSkill({ name: "x", description: "d", scope: "user", enabled: true, interface: { shortDescription: 42 } })).toBe(false);
    expect(isSkill({ name: "x", description: "d", scope: "user", enabled: true, interface: { displayName: "X", shortDescription: "s" } })).toBe(true);
  });

  it("rejects a thread whose name or path is mistyped and accepts null ones", () => {
    expect(isThread({ ...makeThread("T"), name: 42 })).toBe(false);
    expect(isThread({ ...makeThread("T"), path: 7 })).toBe(false);
    expect(isThread({ ...makeThread("T"), name: null, path: null })).toBe(true);
  });
});

describe("live omo notifications", () => {
  const open = () => reduce(createInitialState(), { type: "thread/activated", threadId: "T" });
  const apply = (state: ReturnType<typeof open>, method: string, params: unknown) =>
    reduce(state, { type: "rpc/notification", notification: { method, params }, receivedAtMs: 1 });

  it("shows a live custom message once, placed after the running turn's items", () => {
    const notice = { id: "n1", customType: "omo-kibitzer:recall", display: true, text: "recalled", timestamp: 5 };
    const first = apply(open(), "thread/notice/added", { threadId: "T", notice });
    const again = apply(first, "thread/notice/added", { threadId: "T", notice });
    expect(again.conversations["T"]?.annotations.notices).toEqual([{ ...notice, turnIndex: 0, afterItems: 0 }]);
    expect(parseNotification({ method: "thread/notice/added", params: { threadId: "T", notice: { id: 1 } } })).toBeNull();
  });

  it("follows a model change on the thread and on the composer of the active thread only", () => {
    const params = { threadId: "T", model: "fake/beta", effort: "high", source: "fallback" };
    const active = apply(open(), "thread/settings/changed", params);
    expect(active.conversations["T"]?.session).toEqual({ modelProvider: "fake", model: "beta", reasoningEffort: "high" });
    expect(active.composer).toMatchObject({ modelId: "fake/beta", effort: "high" });
    const other = apply(reduce(open(), { type: "thread/activated", threadId: "U" }), "thread/settings/changed", params);
    expect(other.composer.modelId).not.toBe("fake/beta");
    expect(parseNotification({ method: "thread/settings/changed", params: { threadId: "T", model: 4 } })).toBeNull();
  });

  it("turns an alert into one coded notice per key, pinned when asked", () => {
    const alert = { threadId: "T", key: "transcript:1", level: "error", code: "transcriptWriteFailed", params: { error: "EACCES" }, pinned: true };
    const state = apply(apply(open(), "thread/alert", alert), "thread/alert", alert);
    expect(state.notices).toEqual([expect.objectContaining({ id: "alert:T:transcript:1", level: "error", code: "transcriptWriteFailed", pinned: true, threadId: "T", params: { error: "EACCES" } })]);
    const warning = apply(open(), "thread/alert", { ...alert, key: "ext", level: "warning", code: "extensionError", pinned: false });
    expect(warning.notices[0]).toMatchObject({ level: "warning", code: "extensionError" });
    expect(warning.notices[0]?.pinned).toBeUndefined();
    expect(parseNotification({ method: "thread/alert", params: { ...alert, code: "nope" } })).toBeNull();
  });
});
