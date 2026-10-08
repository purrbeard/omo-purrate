import { describe, expect, it } from "vitest";
import type { Model } from "../../shared/protocol";
import { resolveComposerModel } from "../../src/state";
import { createInitialState, selectThreadsByWorkspace } from "../../src/state";

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
  it("nests only confirmed children once and retains unlinked sessions and in-process tasks", () => {
    const state = createInitialState();
    const thread = (id: string, cwd: string) => ({ id, cwd, path: null, preview: id, name: null, source: "cli", createdAt: 1, updatedAt: 1, status: { type: "idle" as const } });
    state.threads = { main: thread("main", "/main"), child: thread("child", "/other"), plain: thread("plain", "/other") };
    state.threadOrder = ["child", "main", "plain"];
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
