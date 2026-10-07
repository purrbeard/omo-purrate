import { describe, expect, it } from "vitest";
import type { ThreadItem } from "../../shared/protocol";
import type { ConversationItem } from "../../src/state";
import { workLogEntries } from "../../src/ui/conversation/work-log";

function entry(item: ThreadItem): ConversationItem {
  return { item, streaming: false, startedAtMs: null, completedAtMs: null };
}

describe("workLogEntries", () => {
  it("groups only actual work in item order and preserves the original entries", () => {
    const user = entry({ type: "userMessage", id: "u", clientId: null, content: [] });
    const reasoning = entry({ type: "reasoning", id: "r", summary: [], content: [] });
    const task = entry({ type: "dynamicToolCall", id: "task", namespace: null, tool: "task", arguments: {}, status: "completed", contentItems: null, success: true, durationMs: 120 });
    const answer = entry({ type: "agentMessage", id: "a", text: "task", phase: null });
    const plan = entry({ type: "plan", id: "p", text: "task" });
    const compact = entry({ type: "contextCompaction", id: "c" });
    const read = entry({ type: "dynamicToolCall", id: "read", namespace: null, tool: "read", arguments: {}, status: "inProgress", contentItems: null, success: null, durationMs: null });
    read.streaming = true;
    const items = [user, reasoning, task, answer, plan, compact, read];
    const work = workLogEntries(items);
    expect(work).toEqual([reasoning, task, read]);
    expect(work[0]).toBe(reasoning);
    expect(work[2]).toBe(read);
    expect(items).toEqual([user, reasoning, task, answer, plan, compact, read]);
  });

  it("does not create work for a message-only turn", () => {
    expect(workLogEntries([entry({ type: "agentMessage", id: "a", text: "running task", phase: null })])).toEqual([]);
    expect(workLogEntries([])).toEqual([]);
  });
});
