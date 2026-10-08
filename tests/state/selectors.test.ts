import { describe, expect, it } from "vitest";
import type { Model } from "../../shared/protocol";
import { resolveComposerModel } from "../../src/state";
import { createInitialState, selectManagedThreadsByWorkspace, selectAgentThreadsByWorkspace, selectUnknownThreadsByWorkspace, selectThreadsByWorkspace, selectAgentChildren, selectMainThreadId } from "../../src/state";

it("shows only managed IDs regardless of creator and leaves confirmed relations intact", () => {
  const state = createInitialState();
  state.threads = Object.fromEntries(["main", "child", "unknown"].map(id => [id, { id, cwd: "/work", path: null, preview: id, name: null, source: "cli", createdAt: 1, updatedAt: 1, status: { type: "idle" as const } }]));
  state.threadOrder = ["main", "child", "unknown"];
  state.threadOrigins = { main: "dori", child: "agent", unknown: "unknown" };
  state.threadLinks = [{ parentId: "main", childId: "child", origin: "native", title: "child" }];
  expect(selectManagedThreadsByWorkspace(state, ["main", "unknown"]).flatMap(g => g.threads.map(t => t.id))).toEqual(["main", "unknown"]);
  expect(selectAgentChildren(state, "main").map(t => t.id)).toEqual(["child"]);
  expect(selectManagedThreadsByWorkspace(state, [])).toEqual([]);
  expect(Object.keys(state.threads)).toHaveLength(3);
});

const entry = (id: string, isDefault = false): Model => ({
  id,
  model: id.slice(id.indexOf("/") + 1),
  displayName: id,
  description: "",
  hidden: false,
  supportedReasoningEfforts: [],
  defaultReasoningEffort: null,
  isDefault,
});

const catalog = [entry("anthropic/claude-opus-4-8", true), entry("anthropic-subscription/claude-opus-5-5"), entry("openai/gpt-6.1-sol", true)];

describe("thread ownership", () => {
  it("anchors nested native agents to the main session without claiming manual or unknown sessions", () => {
    const state = createInitialState();
    const thread = (id: string) => ({ id, cwd: "/main", path: null, preview: "same title", name: null, source: "cli", updatedAt: 1, status: { type: "idle" as const } });
    state.threads = Object.fromEntries(["main", "agent", "nested", "manual", "unknown"].map(id => [id, thread(id)]));
    state.threadOrder = Object.keys(state.threads);
    state.threadLinks = [{ parentId: "main", childId: "agent", origin: "native", title: "agent" }, { parentId: "agent", childId: "nested", taskId: "task", title: "nested" }, { parentId: "main", childId: "manual", title: "manual" }];
    state.activeThreadId = "nested";
    expect(selectMainThreadId(state)).toBe("main");
    expect(selectAgentChildren(state, "main").map(t => t.id)).toEqual(["agent", "nested"]);
    state.activeThreadId = "manual";
    expect(selectMainThreadId(state)).toBe("manual");
    state.activeThreadId = "unknown";
    expect(selectMainThreadId(state)).toBe("unknown");
  });
  it("separates proven agent roots without guessing titles or dropping orphaned children", () => {
    const state = createInitialState();
    const thread = (id: string) => ({ id, cwd: "/main", path: null, preview: "question-contract", name: null, source: "cli", updatedAt: 1, status: { type: "idle" as const } });
    state.threads = Object.fromEntries(["user", "probe", "orphan", "child"].map(id => [id, thread(id)]));
    state.threadOrder = ["probe", "user", "orphan", "child"];
    state.threadOrigins = { user: "user", probe: "agent", child: "agent" };
    state.threadLinks = [{ parentId: "absent", childId: "orphan", taskId: "task", title: "work" }, { parentId: "user", childId: "child", title: "child" }];
    expect(selectThreadsByWorkspace(state).flatMap(g => g.threads.map(t => t.id))).toEqual(["user"]);
    expect(selectThreadsByWorkspace(state)[0]?.threads[0]?.children?.map(t => t.id)).toEqual(["child"]);
    expect(selectAgentThreadsByWorkspace(state).flatMap(g => g.threads.map(t => t.id))).toEqual(["probe"]);
    expect(selectUnknownThreadsByWorkspace(state).flatMap(g => g.threads.map(t => t.id))).toEqual(["orphan"]);
    expect(Object.keys(state.threads)).toHaveLength(4);
  });
  it("nests only confirmed children once and retains unlinked sessions and in-process tasks", () => {
    const state = createInitialState();
    const thread = (id: string, cwd: string) => ({ id, cwd, path: null, preview: id, name: null, source: "cli", createdAt: 1, updatedAt: 1, status: { type: "idle" as const } });
    state.threads = { main: thread("main", "/main"), child: thread("child", "/other"), plain: thread("plain", "/other") };
    state.threadOrder = ["child", "main", "plain"];
    state.threadOrigins = { main: "user", plain: "user" };
    state.threadLinks = [{ parentId: "main", childId: "child", title: "child" }, { parentId: "main", taskId: "task", title: "work", status: "completed" }];
    const groups = selectThreadsByWorkspace(state);
    expect(groups.flatMap(group => group.threads.map(t => t.id))).toEqual(["main", "plain"]);
    expect(groups[0]?.threads[0]?.children?.map(t => t.id)).toEqual(["child"]);
    expect(groups[0]?.threads[0]?.tasks?.map(t => t.taskId)).toEqual(["task"]);
    expect(state.threads["child"]?.cwd).toBe("/other");
    state.threadLinks = [...state.threadLinks, { parentId: "child", childId: "main", title: "cycle" }];
    expect(selectThreadsByWorkspace(state).flatMap(g => g.threads.map(t => t.id))).toEqual(["main", "plain"]);
  });
});

describe("resolveComposerModel", () => {
  it("prefers the model the user picked", () => {
    expect(resolveComposerModel(catalog, "openai/gpt-6.1-sol", null)?.id).toBe("openai/gpt-6.1-sol");
  });

  it("does not replace an unavailable explicit pick with the active thread model", () => {
    expect(resolveComposerModel(catalog, "opencodex/disabled", { modelProvider: "openai", model: "gpt-6.1-sol", reasoningEffort: "high" })).toBeNull();
  });

  it("uses the model omo reported for the active thread instead of a per-provider default", () => {
    const session = { modelProvider: "anthropic-subscription", model: "claude-opus-5-5", reasoningEffort: "medium" as const };
    expect(resolveComposerModel(catalog, null, session)?.id).toBe("anthropic-subscription/claude-opus-5-5");
  });

  it("matches by model name when the reported provider is not in the catalog", () => {
    expect(resolveComposerModel(catalog, null, { modelProvider: "elsewhere", model: "gpt-6.1-sol", reasoningEffort: null })?.id).toBe(
      "openai/gpt-6.1-sol",
    );
  });

  it("returns null without a pick or an active thread so the UI names omo's own default", () => {
    expect(resolveComposerModel(catalog, null, null)).toBeNull();
  });
});
