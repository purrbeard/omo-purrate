import { describe, expect, it } from "vitest";
import type { ConversationItem, ConversationTurn } from "../../src/state";
import { durationParts, workingStatus } from "../../src/ui/conversation/working-status";

const user = (id: string, at: number): ConversationItem => ({
  item: { type: "userMessage", id, clientId: null, content: [{ type: "text", text: id, text_elements: [] }] },
  streaming: false,
  startedAtMs: at,
  completedAtMs: at,
});
const agent = (id: string, at: number): ConversationItem => ({
  item: { type: "agentMessage", id, text: "ok", phase: null },
  streaming: false,
  startedAtMs: at,
  completedAtMs: at,
});
const turn = (items: ConversationItem[]): ConversationTurn => ({
  id: "t",
  status: "inProgress",
  error: null,
  items,
  startedAtMs: 1_000_000,
  completedAtMs: null,
  origin: "live",
});

describe("workingStatus", () => {
  it("measures the run and the silence since the newest item", () => {
    const status = workingStatus(turn([user("prompt", 1_000_010), agent("a", 1_060_000)]), 1_300_000);
    expect(status).toEqual({ elapsedMs: 300_000, idleMs: 240_000, queuedMessage: false });
  });

  it("does not call the turn's own opening prompt queued", () => {
    expect(workingStatus(turn([user("prompt", 1_000_005)]), 1_100_000).queuedMessage).toBe(false);
  });

  it("calls a message sent into the running turn queued, even when it is the turn's first item", () => {
    expect(workingStatus(turn([user("steer", 1_240_000)]), 1_300_000).queuedMessage).toBe(true);
    expect(workingStatus(turn([user("prompt", 1_000_005), agent("a", 1_050_000), user("steer", 1_240_000)]), 1_300_000)).toEqual({
      elapsedMs: 300_000,
      idleMs: 60_000,
      queuedMessage: true,
    });
  });

  it("clears the queued state once omo answers after the message", () => {
    expect(workingStatus(turn([user("steer", 1_240_000), agent("reply", 1_250_000)]), 1_300_000).queuedMessage).toBe(false);
  });

  it("splits durations into minutes and seconds", () => {
    expect(durationParts(255_900)).toEqual({ minutes: 4, seconds: 15 });
    expect(durationParts(9_000)).toEqual({ minutes: 0, seconds: 9 });
  });
});
