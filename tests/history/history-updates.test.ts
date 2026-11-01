import { describe, expect, it } from "vitest";
import type { HistoryResult, HistoryTurn } from "../../shared/ipc";
import { HistoryUpdates } from "../../electron/history/history-updates";
import { parseSessionJsonl, SessionJsonlParser } from "../../electron/history/session-jsonl";
import { sessionOutline } from "../../electron/history/session-outline";

const turn = (id: string, text = id): HistoryTurn => ({
  id, status: "completed", error: null, startedAt: 1, completedAt: 2,
  items: [
    { type: "userMessage", id: `${id}-user`, clientId: null, content: [{ type: "text", text, text_elements: [] }] },
    { type: "commandExecution", id: `${id}-run`, command: "ls", cwd: "/", status: "completed", aggregatedOutput: "x".repeat(5_000), exitCode: 0, durationMs: 1 },
    { type: "agentMessage", id: `${id}-answer`, text: `answer ${text}` },
  ],
} as HistoryTurn);
const history = (...turns: HistoryTurn[]): HistoryResult => ({ turns, todo: null, tasks: [] });
const ids = (turns: HistoryTurn[]): string[] => turns.map((entry) => entry.id);
const outputLength = (entry: HistoryTurn): number => {
  const run = entry.items.find((item) => item.type === "commandExecution");
  return run?.type === "commandExecution" ? (run.aggregatedOutput ?? "").length : -1;
};

const usageMessage = (id: string, parentId: string | null, role: string, usage?: unknown, content: unknown = "answer") =>
  JSON.stringify({ type: "message", id, parentId, message: { role, content, usage, stopReason: "stop" } });
const reportedUsage = { input: 10, output: 2, cacheRead: 30, cacheWrite: 0, totalTokens: 42 };

describe("history usage transport", () => {
  it("sums active-branch assistant messages once, excluding tool-result usage", () => {
    const records = [
      usageMessage("u", null, "user"),
      usageMessage("discarded", "u", "assistant", { input: 999, output: 999, cacheRead: 999, cacheWrite: 999, totalTokens: 3996 }),
      usageMessage("a", "u", "assistant", reportedUsage, [{ type: "toolCall", id: "t", name: "read" }]),
      usageMessage("r", "a", "toolResult", { input: 888, output: 888, cacheRead: 888, cacheWrite: 888, totalTokens: 3552 }),
      usageMessage("b", "r", "assistant", reportedUsage, [{ type: "thinking", thinking: "reason" }, { type: "text", text: "done" }]),
    ];
    expect(parseSessionJsonl(records.join("\n")).turns[0]).toMatchObject({ usage: { input: 20, output: 4, cacheRead: 60, cacheWrite: 0, totalTokens: 84 } });
  });

  it("keeps incomplete fields unknown without deriving totals or converting omissions to zero", () => {
    const records = [
      usageMessage("u", null, "user"),
      usageMessage("a", "u", "assistant", reportedUsage),
      usageMessage("b", "a", "assistant", { input: 0, output: -1, cacheRead: "30", cacheWrite: 0 }),
    ];
    expect(parseSessionJsonl(records.join("\n")).turns[0]).toMatchObject({ usage: { input: 10, output: null, cacheRead: null, cacheWrite: 0, totalTokens: null } });
    records.push(usageMessage("c", "b", "assistant"));
    expect(parseSessionJsonl(records.join("\n")).turns[0]).toMatchObject({ usage: { input: null, output: null, cacheRead: null, cacheWrite: null, totalTokens: null } });
    expect(parseSessionJsonl(usageMessage("u", null, "user")).turns[0]?.usage ?? null).toBeNull();
  });

  it("retains complete and empty usage through outlines, hydration, repeated reads and work summaries", () => {
    const records = [
      usageMessage("u", null, "user"),
      usageMessage("a", "u", "assistant", reportedUsage),
      usageMessage("b", "a", "assistant", reportedUsage),
      usageMessage("u2", "b", "user"),
      usageMessage("c", "u2", "assistant", {}),
    ];
    for (const summary of [false, true]) {
      const parser = new SessionJsonlParser(summary);
      for (const record of records) parser.add(sessionOutline(record));
      const expected = [{ input: 20, output: 4, cacheRead: 60, cacheWrite: 0, totalTokens: 84 }, { input: null, output: null, cacheRead: null, cacheWrite: null, totalTokens: null }];
      expect(parser.result().turns.map(entry => entry.usage)).toEqual(expected);
      const requested = parser.pageEntries(0, 1);
      expect(parser.result(records.slice(0, 3), requested).turns.map(entry => entry.usage)).toEqual(expected);
      expect(parser.result(records.slice(0, 3), requested).turns.map(entry => entry.usage)).toEqual(expected);
      const updates = new HistoryUpdates();
      expect(updates.update("/usage.jsonl", parser.result(), null, -1).turns.map(entry => entry.usage)).toEqual(expected);
    }
  });
});

describe("history updates", () => {
  it("sends every turn to a reader it does not know", () => {
    const update = new HistoryUpdates().update("/s.jsonl", history(turn("t1"), turn("t2")), null);
    expect(update).toMatchObject({ from: 0, removed: 0, total: 2, fullFrom: 0 });
    expect(ids(update.turns)).toEqual(["t1", "t2"]);
  });

  it("sends only the turns appended since the reader's last read", () => {
    const updates = new HistoryUpdates();
    const first = updates.update("/s.jsonl", history(turn("t1"), turn("t2")), null);
    const next = updates.update("/s.jsonl", history(turn("t1"), turn("t2"), turn("t3")), first.token);
    expect(next).toMatchObject({ from: 2, removed: 0, total: 3 });
    expect(ids(next.turns)).toEqual(["t3"]);
    expect(next.token).not.toBe(first.token);
  });

  it("resends only a turn whose content changed", () => {
    const updates = new HistoryUpdates();
    const first = updates.update("/s.jsonl", history(turn("t1"), turn("t2"), turn("t3")), null);
    const next = updates.update("/s.jsonl", history(turn("t1"), turn("t2", "edited"), turn("t3")), first.token);
    expect(next).toMatchObject({ from: 1, removed: 1 });
    expect(ids(next.turns)).toEqual(["t2"]);
  });

  it("sends nothing when no turn changed, and everything to a stale reader", () => {
    const updates = new HistoryUpdates();
    const first = updates.update("/s.jsonl", history(turn("t1")), null);
    const second = updates.update("/s.jsonl", history(turn("t1")), first.token);
    expect(second).toMatchObject({ from: 1, removed: 0, total: 1, turns: [] });
    expect(updates.update("/s.jsonl", history(turn("t1")), first.token)).toMatchObject({ from: 0, removed: 0, total: 1 });
  });

  it("cuts the long strings of the turns before fullFrom, counted from the end when negative", () => {
    const prompt = "full user prompt ".repeat(180);
    const update = new HistoryUpdates().update("/s.jsonl", history(turn("t1", prompt), turn("t2"), turn("t3")), null, -1);
    expect(update.fullFrom).toBe(2);
    expect(update.turns.map((entry) => entry.items.map((item) => item.type))).toEqual(Array(3).fill(["userMessage", "commandExecution", "agentMessage"]));
    expect(update.turns.map((entry) => outputLength(entry))).toEqual([2_001, 2_001, 5_000]);
    expect(update.turns[0]?.items[0]).toMatchObject({ type: "userMessage", content: [{ type: "text", text: prompt }] });
  });

  it("replaces outlines with full turns when the reader asks for an earlier fullFrom", () => {
    const updates = new HistoryUpdates();
    const sessionHistory = history(turn("t1"), turn("t2"), turn("t3"), turn("t4"));
    const first = updates.update("/s.jsonl", sessionHistory, null, -1);
    const wider = updates.update("/s.jsonl", sessionHistory, first.token, 1);
    expect(wider).toMatchObject({ from: 1, removed: 2, fullFrom: 1 });
    expect(ids(wider.turns)).toEqual(["t2", "t3"]);
    expect(wider.turns.map((entry) => outputLength(entry))).toEqual([5_000, 5_000]);
  });

  it("keeps the session's small fields whole", () => {
    const update = new HistoryUpdates().update("/s.jsonl", { ...history(turn("t1")), todo: { phases: [] }, model: { provider: "p", modelId: "m", thinkingLevel: null } }, null);
    expect(update.todo).toEqual({ phases: [] });
    expect(update.model).toEqual({ provider: "p", modelId: "m", thinkingLevel: null });
  });
});
