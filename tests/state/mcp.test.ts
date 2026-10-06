import { describe, expect, it } from "vitest";
import { mcpDisplayStatus, normalizeMcpPage } from "../../src/state/mcp";
import { parseNotification } from "../../src/state/wire";

const server = { name: "demo", serverInfo: null, tools: {}, resources: [], resourceTemplates: [], authStatus: "unsupported" };
const page = (data: unknown[]) => normalizeMcpPage({ data, nextCursor: null });

describe("MCP wire normalization", () => {
  it("sorts tools and drops malformed servers and tools", () => {
    const normalized = page([null, {}, { ...server, authStatus: 4 }, { ...server, serverInfo: {} },
      { ...server, tools: { z: { name: "z", description: "Last" }, a: { name: "a" }, bad: { name: 1 }, badDescription: { name: "bad", description: [] } } }]);
    expect(normalized.servers).toHaveLength(1);
    expect(normalized.servers[0]?.tools).toEqual([{ name: "a" }, { name: "z", description: "Last" }]);
  });
  it("preserves unknown auth and status strings and cursors", () => {
    const result = normalizeMcpPage({ data: [{ ...server, authStatus: "futureAuth", status: "warming_up" }], nextCursor: "next" });
    expect(result.nextCursor).toBe("next");
    expect(result.servers[0]?.authStatus).toBe("futureAuth");
    expect(mcpDisplayStatus(result.servers[0]!)).toBe("warming_up");
  });
  it.each([null, {}, { data: {}, nextCursor: null }, { data: [], nextCursor: 3 }])("rejects malformed pages %j", (value) => {
    expect(() => normalizeMcpPage(value)).toThrow();
  });
  it("accepts notification params without assuming their schema", () => {
    for (const params of [undefined, null, 1, { threadId: "x", status: "future" }]) {
      expect(parseNotification({ method: "mcpServer/startupStatus/updated", params })).toEqual({ method: "mcpServer/startupStatus/updated", params });
    }
  });
});

describe("omo display status precedence", () => {
  it.each([
    [{ status: "unsupported" }, "unsupported"],
    [{ status: "starting", serverInfo: { name: "demo", version: "1" } }, "starting"],
    [{ serverInfo: { name: "demo", version: "1" }, authStatus: "notLoggedIn" }, "connected"],
    [{ authStatus: "notLoggedIn" }, "needs_auth"],
    [{ authStatus: "unsupported" }, "enabled"],
    [{ authStatus: "bearerToken" }, "enabled"],
    [{ authStatus: "future" }, "enabled"],
  ])("derives %j as %s", (overrides, expected) => {
    expect(mcpDisplayStatus(page([{ ...server, ...overrides }]).servers[0]!)).toBe(expected);
  });
});
