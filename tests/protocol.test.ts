import { describe, expect, it } from "vitest";
import { CLIENT_METHODS, isKnownItem } from "../shared/protocol";
import { parseNotification } from "../src/state/wire";

describe("protocol", () => {
  it("accepts a known item type", () => {
    expect(isKnownItem({ type: "agentMessage" })).toBe(true);
  });

  it("rejects an unknown item type", () => {
    expect(isKnownItem({ type: "futureItem" })).toBe(false);
  });

  it("allows turn/start but not command/exec from the renderer", () => {
    const methods: readonly string[] = CLIENT_METHODS;
    expect(methods).toContain("turn/start");
    expect(methods).toContain("skills/list");
    expect(methods).not.toContain("command/exec");
  });

  it("parses skills/changed as an empty invalidation signal", () => {
    expect(parseNotification({ method: "skills/changed", params: {} })).toEqual({ method: "skills/changed", params: {} });
    expect(parseNotification({ method: "skills/changed", params: [] })).toBeNull();
    expect(parseNotification({ method: "skills/changed", params: { cwd: "/tmp" } })).toBeNull();
    expect(parseNotification({ method: "skills/changed" })).toBeNull();
  });

});
