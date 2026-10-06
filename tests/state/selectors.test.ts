import { describe, expect, it } from "vitest";
import type { Model } from "../../shared/protocol";
import { resolveComposerModel } from "../../src/state";

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

describe("resolveComposerModel", () => {
  it("prefers the model the user picked", () => {
    expect(resolveComposerModel(catalog, "openai/gpt-6.1-sol", null)?.id).toBe("openai/gpt-6.1-sol");
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
