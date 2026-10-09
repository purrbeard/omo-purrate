import { describe, expect, it } from "vitest";
import type { Model, ReasoningEffort } from "../../shared/protocol";
import { groupModels, normalizeModel, resolveEffort } from "../../src/ui/composer/model-groups";

const model = (id: string, displayName: string): Model => ({ id, model: id.slice(10), displayName, hidden: false, isDefault: false, description: "", supportedReasoningEfforts: [], defaultReasoningEffort: null });

describe("OpenCodex provider groups", () => {
  it("separates routing providers and OpenAI accounts while preserving original IDs", () => {
    const models = [model("opencodex/gpt-6.1-sol", "openai · gpt-6.1-sol"), model("opencodex/p2bc7fb/gpt-6.1-sol", "openai · p2bc7fb/gpt-6.1-sol"), model("opencodex/opencode-go/deepseek-v4.1-flash", "opencode · opencode-go/deepseek-v4.1-flash"), model("opencodex/cursor/claude-opus-5-5", "cursor · cursor/claude-opus-5-5")];
    const groups = groupModels(models);
    expect(groups.map(group => group.provider)).toEqual(["OpenCodex / openai", "OpenCodex / openai / p2bc7fb", "OpenCodex / opencode-go", "OpenCodex / cursor"]);
    expect(groups.flatMap(group => group.models.map(entry => entry.id))).toEqual(models.map(entry => entry.id));
  });
});

const efforts = (offered: ReasoningEffort[], fallback: ReasoningEffort | null): Model => ({ ...model("opencodex/opencode-go/deepseek-v4.1-flash", "deepseek"),
  supportedReasoningEfforts: offered.map(reasoningEffort => ({ reasoningEffort, description: "" })), defaultReasoningEffort: fallback });

describe("catalog normalization", () => {
  it("gives a model that does not reason no levels and no default", () => {
    expect(normalizeModel(efforts([], "medium"))).toMatchObject({ supportedReasoningEfforts: [], defaultReasoningEffort: null });
  });
  it("drops unknown and repeated levels and moves the default onto an offered one", () => {
    const raw = { ...efforts([], "medium"), supportedReasoningEfforts: ["max", "low", "low", "ultra", "high"].map(reasoningEffort => ({ reasoningEffort: reasoningEffort as ReasoningEffort, description: "" })) };
    const normalized = normalizeModel(raw);
    expect(normalized.supportedReasoningEfforts.map(entry => entry.reasoningEffort)).toEqual(["low", "high", "max"]);
    expect(normalized.defaultReasoningEffort).toBe("high");
  });
});

describe("effort resolution", () => {
  it("offers nothing for a model without levels, whatever was chosen before", () => {
    expect(resolveEffort(efforts([], "medium"), "high")).toBeNull();
  });
  it("keeps a chosen effort the model offers", () => {
    expect(resolveEffort(efforts(["low", "high", "max"], "high"), "max")).toBe("max");
  });
  it("replaces a default the model does not offer with the next stronger offered level", () => {
    expect(resolveEffort(efforts(["low", "high", "max"], "medium"), null)).toBe("high");
    expect(resolveEffort(efforts(["low", "high", "max"], "medium"), "minimal")).toBe("high");
  });
  it("uses the strongest offered level when nothing stronger exists", () => {
    expect(resolveEffort(efforts(["low", "medium"], "xhigh"), null)).toBe("medium");
  });
});
