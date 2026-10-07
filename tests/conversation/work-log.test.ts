import { describe, expect, it } from "vitest";
import type { HistoricalTask } from "../../shared/ipc";
import type { LiveTask } from "../../shared/protocol";
import type { ConversationItem, ConversationTurn } from "../../src/state";
import { answerCompletedAt, completedAnswer, turnSubagents } from "../../src/ui/conversation/work-log";

const base = Date.parse("2026-10-07T09:00:00Z");
function turn(id: string, start: number | null, end: number | null): ConversationTurn {
  return { id, startedAtMs: start, completedAtMs: end, status: end === null ? "inProgress" : "completed", error: null, items: [], origin: "live" };
}
function task(id: string, at: number): LiveTask {
  return { task_id: id, status: "running", execution_mode: "in-process", model: "fake/alpha", residency_state: "resident", depth: 1,
    created_at: new Date(at).toISOString(), updated_at: new Date(at).toISOString() };
}
function answer(id: string, phase: "commentary" | "final_answer" | null = null): ConversationItem {
  return { item: { type: "agentMessage", id, text: id, phase }, streaming: false, startedAtMs: null, completedAtMs: null };
}

describe("turnSubagents", () => {
  it("compares native second-precision clocks without losing a task created during the completion second", () => {
    const first = turn("first", base, base);
    const native = task("native", base + 450);
    expect(turnSubagents(first, [first], [native])).toEqual([native]);
    const overlapping = turn("second", base, base + 1000);
    expect(turnSubagents(first, [first, overlapping], [native])).toEqual([]);
  });
  it("keeps old background work on its original turn during a follow-up, in roster order", () => {
    const first = turn("first", base, base + 100);
    const second = turn("second", base + 200, null);
    const old = task("old", base + 50);
    const fresh = task("fresh", base + 250);
    const unknown = task("outside", base - 1);
    const tasks = [old, unknown, fresh, old];
    expect(turnSubagents(first, [first, second], tasks)).toEqual([old]);
    expect(turnSubagents(second, [first, second], tasks)).toEqual([fresh]);
    expect(turnSubagents(first, [first, second], tasks)[0]).toBe(old);
  });

  it("rejects overlapping turns and shared boundaries without slack", () => {
    const first = turn("first", base, base + 100);
    const second = turn("second", base + 80, base + 200);
    const overlap = task("overlap", base + 90);
    expect(turnSubagents(first, [first, second], [overlap])).toEqual([]);
    expect(turnSubagents(second, [first, second], [overlap])).toEqual([]);
    second.startedAtMs = base + 100;
    const boundary = task("boundary", base + 100);
    expect(turnSubagents(first, [first, second], [boundary])).toEqual([]);
    expect(turnSubagents(second, [first, second], [boundary])).toEqual([]);
    expect(turnSubagents(first, [first, second], [task("gap", base + 101)])).toEqual([]);
  });

  it("excludes historical tasks and missing clocks but preserves a recorded turn window after hydration", () => {
    const live = turn("live", base, base + 100);
    const historical: HistoricalTask = { task_id: "history", source: "history", status: "completed" };
    const invalid = { ...task("invalid", base + 50), created_at: "" };
    expect(turnSubagents(live, [live], [historical, invalid])).toEqual([]);
    const restored = { ...live, origin: "history" as const };
    const native = task("new", base + 50);
    expect(turnSubagents(restored, [restored], [native])).toEqual([native]);
    for (const start of [null, NaN, Infinity]) {
      live.startedAtMs = start;
      expect(turnSubagents(live, [live], [task("new", base + 50)])).toEqual([]);
    }
    live.startedAtMs = base;
    live.completedAtMs = null;
    expect(turnSubagents(live, [live], [task("new", base + 50)])).toEqual([]);
    live.completedAtMs = base - 1;
    expect(turnSubagents(live, [live], [task("new", base + 50)])).toEqual([]);
  });

  it("does not use task titles, tool-result prose or depth to claim ownership", () => {
    const live = turn("live", base, base + 100);
    live.items = [{ item: { type: "dynamicToolCall", id: "call", namespace: null, tool: "task", arguments: {}, status: "completed",
      contentItems: [{ type: "inputText", text: "Started task Outside (outside, running)." }], success: true, durationMs: 0 },
      streaming: false, startedAtMs: base, completedAtMs: base + 10 }];
    expect(turnSubagents(live, [live], [{ ...task("outside", base - 1), name: "live", depth: 1 }])).toEqual([]);
  });
});

describe("completed answer actions", () => {
  it("chooses only the last final answer of a successful settled turn", () => {
    const live = turn("answer", base, base + 100);
    const final = answer("final", "final_answer");
    live.items = [answer("first"), final, answer("commentary", "commentary")];
    expect(completedAnswer(live)).toBe(final);
    final.streaming = true;
    expect(completedAnswer(live)).toBeNull();
    final.streaming = false;
    for (const status of ["inProgress", "failed", "interrupted"] as const) {
      expect(completedAnswer({ ...live, status })).toBeNull();
    }
    expect(completedAnswer({ ...live, items: [answer("only-commentary", "commentary")] })).toBeNull();
    expect(completedAnswer({ ...live, items: [] })).toBeNull();
  });

  it("uses recorded item completion, then turn completion, and never invents a clock", () => {
    const live = turn("answer", base, base + 100);
    const final = answer("final");
    final.completedAtMs = base + 50;
    expect(answerCompletedAt(live, final)).toBe(base + 50);
    final.completedAtMs = NaN;
    expect(answerCompletedAt(live, final)).toBe(base + 100);
    live.completedAtMs = null;
    expect(answerCompletedAt(live, final)).toBeNull();
    final.completedAtMs = 0;
    expect(answerCompletedAt(live, final)).toBe(0);
  });
});
