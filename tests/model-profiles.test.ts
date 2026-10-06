import { describe, expect, it } from "vitest";
import type { Model, ReasoningEffort } from "../shared/protocol";
import {
  laneAt,
  PROFILE_LANES,
  resolveProfile,
} from "../src/ui/composer/model-profiles";

const model = (
  id: string,
  displayName = id,
  efforts: ReasoningEffort[] = ["medium", "xhigh"],
): Model => ({
  id,
  model: id,
  displayName,
  hidden: false,
  description: "",
  isDefault: false,
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
    reasoningEffort,
    description: "",
  })),
});
const catalog = [
  model("claude-opus-5-5", "Claude Opus 5.5"),
  model("claude-fable-5-1", "Claude Fable 5.1"),
  model("gpt-6-astra", "GPT-6 Astra"),
  model("gpt-6-sol-fast", "GPT-6 Sol Fast"),
];

describe("profile lanes", () => {
  it.each([
    ["daily-normal", "claude-opus-5-5", "medium"],
    ["daily-heavy", "claude-fable-5-1", "xhigh"],
    ["geeky-heavy", "gpt-6-astra", "xhigh"],
    ["geeky-normal", "gpt-6-sol-fast", "medium"],
  ] as const)("resolves %s", (profile, id, effort) => {
    expect(resolveProfile(catalog, profile)).toEqual({
      model: catalog.find((entry) => entry.id === id),
      effort,
    });
  });
  it("matches display names when ids are opaque", () => {
    const entry = model("opaque", "Claude Fable 5.1");
    expect(resolveProfile([entry], "daily-heavy").model).toBe(entry);
  });
  it("prefers the nearest named family, then provider family", () => {
    const opus = model("claude-opus-4");
    const other = model("claude-sonnet-5");
    expect(resolveProfile([other, opus], "daily-normal").model).toBe(opus);
    expect(resolveProfile([other], "daily-heavy").model).toBe(other);
  });
  it("falls back to default then first visible and excludes hidden", () => {
    const hidden = { ...catalog[2]!, hidden: true };
    const first = model("first");
    const fallback = { ...model("default"), isDefault: true };
    expect(resolveProfile([hidden, first, fallback], "geeky-heavy").model).toBe(
      fallback,
    );
    expect(resolveProfile([hidden, first], "geeky-heavy").model).toBe(first);
    expect(resolveProfile([hidden], "geeky-heavy")).toEqual({
      model: null,
      effort: null,
    });
  });
  it("clamps effort to the nearest supported level, not an unsupported default", () => {
    expect(
      resolveProfile(
        [model("gpt-6-astra", undefined, ["low", "high"])],
        "geeky-heavy",
      ).effort,
    ).toBe("high");
    expect(
      resolveProfile(
        [model("claude-opus-5-5", undefined, ["low", "high"])],
        "daily-normal",
      ).effort,
    ).toBe("low");
    expect(
      resolveProfile([model("claude-opus-5-5", undefined, [])], "daily-normal")
        .effort,
    ).toBeNull();
  });
  it("maps pad quadrants to centres including the boundary", () => {
    for (const lane of PROFILE_LANES)
      expect(laneAt(lane.x, lane.y)).toBe(lane.id);
    expect(laneAt(0.5, 0.5)).toBe("geeky-normal");
  });
});
