/// <reference types="vite/client" />
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ContextGaugeUsage } from "../../src/ui/composer/use-context-usage";
import { ContextGauge } from "../../src/ui/composer/ContextGauge";
import { TurnView } from "../../src/ui/conversation/TurnView";
import type { ConversationTurn } from "../../src/state";

const context = vi.hoisted((): { usage: ContextGaugeUsage | null } => ({ usage: null }));
vi.mock("../../src/ui/composer/use-context-usage", () => ({ useContextUsage: () => context.usage }));
vi.mock("../../src/ui/ui-state", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/ui/ui-state")>(),
  useUiState: () => ({ preferences: null }),
}));

const completed: ConversationTurn = {
  id: "usage-turn", status: "completed", error: null, startedAtMs: null, completedAtMs: null, origin: "history",
  items: [{ item: { id: "answer", type: "agentMessage", text: "Recorded answer" }, streaming: false, startedAtMs: null, completedAtMs: null }],
};

function turnMarkup(usage: { input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null; totalTokens: number | null } | undefined, streaming = false): string {
  const turn = { ...completed, ...(usage === undefined ? {} : { usage }), ...(streaming ? { status: "inProgress" as const } : {}) };
  return renderToStaticMarkup(createElement(TurnView, { turn, cwd: null }));
}

describe("completed answer usage", () => {
  it("shows native counters and divides cache hits by all input components", () => {
    const html = turnMarkup({ input: 200, output: 50, cacheRead: 600, cacheWrite: 200, totalTokens: 1050 });
    expect(html).toContain('data-testid="turn-usage"');
    expect(html).toContain('data-cache-hit="60"');
    expect(html).toContain('data-total-tokens="1050"');
    expect(html.indexOf('data-testid="turn-usage"')).toBeLessThan(html.indexOf('data-testid="answer-footer"'));
  });

  it.each([
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    { input: 200, output: null, cacheRead: 600, cacheWrite: null, totalTokens: null },
    undefined,
  ])("keeps missing fields distinct from real zero without inventing a cache hit", usage => {
    const html = turnMarkup(usage);
    expect(html).toContain('data-testid="turn-usage"');
    expect(html).toContain('data-cache-hit=""');
    expect(html).toContain(`data-output="${usage?.output ?? ""}"`);
    expect(html).toContain(`data-total-tokens="${usage?.totalTokens ?? ""}"`);
    expect(html).toContain("-");
  });

  it("omits usage while an answer is still streaming", () => {
    expect(turnMarkup({ input: 200, output: 50, cacheRead: 600, cacheWrite: 200, totalTokens: 1050 }, true)).not.toContain('data-testid="turn-usage"');
  });
});

describe("context gauge accessible detail", () => {
  it("exposes session components separately from current context", () => {
    context.usage = { tokens: 125, window: 128000, compacted: false, input: 200, output: 50, cacheRead: 600, cacheWrite: 200, totalTokens: 1050, cost: 0 };
    const html = renderToStaticMarkup(createElement(ContextGauge));
    expect(html).toContain('data-input="200"');
    expect(html).toContain('data-output="50"');
    expect(html).toContain('data-cache-read="600"');
    expect(html).toContain('data-cache-write="200"');
    expect(html).toContain('data-tokens="125"');
    expect(html).toContain('data-total-tokens="1050"');
    expect(html).toContain("$0.00");
  });

  it("does not turn unavailable session counters or cost into zero", () => {
    context.usage = { tokens: 125, window: 128000, compacted: false, input: null, output: null, cacheRead: null, cacheWrite: null, totalTokens: null, cost: null };
    const html = renderToStaticMarkup(createElement(ContextGauge));
    expect(html).toContain('data-total-tokens=""');
    expect(html).toContain('data-cache-read=""');
    expect(html).toContain('data-cost=""');
    expect(html).toContain("Input: -");
    expect(html).toContain("Session cost: -");
  });
});
