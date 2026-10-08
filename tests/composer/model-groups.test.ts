import { describe, expect, it } from "vitest";
import type { Model } from "../../shared/protocol";
import { groupModels } from "../../src/ui/composer/model-groups";

const model = (id: string, displayName: string): Model => ({ id, model: id.slice(10), displayName, hidden: false, isDefault: false, description: "", supportedReasoningEfforts: [], defaultReasoningEffort: null });

describe("OpenCodex provider groups", () => {
  it("separates routing providers and OpenAI accounts while preserving original IDs", () => {
    const models = [model("opencodex/gpt-6.1-sol", "openai · gpt-6.1-sol"), model("opencodex/p2bc7fb/gpt-6.1-sol", "openai · p2bc7fb/gpt-6.1-sol"), model("opencodex/opencode-go/deepseek-v4.1-flash", "opencode · opencode-go/deepseek-v4.1-flash"), model("opencodex/cursor/claude-opus-5-5", "cursor · cursor/claude-opus-5-5")];
    const groups = groupModels(models);
    expect(groups.map(group => group.provider)).toEqual(["OpenCodex / openai", "OpenCodex / openai / p2bc7fb", "OpenCodex / opencode-go", "OpenCodex / cursor"]);
    expect(groups.flatMap(group => group.models.map(entry => entry.id))).toEqual(models.map(entry => entry.id));
  });
});
