import { describe, expect, it } from "vitest";
import { readContextUsage } from "../../electron/workbench/context-usage";

const jsonl = (...entries: unknown[]) => entries.map((entry) => JSON.stringify(entry)).join("\n");
const assistant = (id: string, parentId: string | null, usage: unknown) => ({
  id, parentId, type: "message", message: { role: "assistant", provider: "fake", model: "alpha", usage },
});
const usage = { input: 10, output: 5, cacheRead: 20, cacheWrite: 2, totalTokens: 999 };

describe("context usage", () => {
  it("uses the last assistant usage on the active branch, including caches", () => {
    const text = jsonl({ type: "session", id: "header" }, assistant("a", null, usage),
      assistant("b", "a", { ...usage, input: 100 }), { id: "tail", parentId: "b", type: "custom" });
    expect(readContextUsage(text)).toEqual({ tokens: 127, provider: "fake", model: "alpha", compacted: false });
  });

  it("invalidates tokens after compaction until a new assistant usage", () => {
    const entries = [assistant("a", null, usage), { id: "compact", parentId: "a", type: "compaction", tokensBefore: 200 }];
    expect(readContextUsage(jsonl(...entries))).toEqual({ tokens: null, provider: "fake", model: "alpha", compacted: true });
    expect(readContextUsage(jsonl(...entries, assistant("b", "compact", usage))).tokens).toBe(37);
    expect(readContextUsage(jsonl(...entries, assistant("b", "compact", usage))).compacted).toBe(false);
  });

  it("falls back to totalTokens only when components are missing", () => {
    expect(readContextUsage(jsonl(assistant("a", null, { input: 1, totalTokens: 123 })))).toEqual({
      tokens: 123, provider: "fake", model: "alpha", compacted: false,
    });
  });

  it("ignores usage and compaction on an abandoned branch", () => {
    const text = jsonl(assistant("a", null, usage), assistant("abandoned", "a", { totalTokens: 500 }),
      { id: "compact", parentId: "abandoned", type: "compaction" }, { id: "active", parentId: "a", type: "message", message: { role: "user" } });
    expect(readContextUsage(text)).toEqual({ tokens: 37, provider: "fake", model: "alpha", compacted: false });
  });

  it("returns unknown without usage and safely handles malformed lines and cycles", () => {
    expect(readContextUsage(jsonl({ id: "compact", parentId: "compact", type: "compaction" }) + "\n{")).toEqual({
      tokens: null, provider: null, model: null, compacted: false,
    });
  });
});
