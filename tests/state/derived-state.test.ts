import { describe, expect, it } from "vitest";
import { OMO_INSTALL_COMMAND } from "../../shared/ipc";
import type { LiveTask } from "../../shared/protocol";
import { createInitialState, selectPendingRequestsForThread } from "../../src/state";
import { emptyConversation } from "../../src/state/conversation";
import type { AppState, Conversation, ConversationTurn, PendingRequest } from "../../src/state";
import { selectCompletedTurnCount } from "../../src/ui/git/use-git-info";
import { selectCompactionCount, selectCompletedCount } from "../../src/ui/composer/use-context-usage";
import { isLiveRunning, runningInputsKey } from "../../src/ui/sidebar/thread-filter";

const turn = (id: string, status: ConversationTurn["status"], items: ConversationTurn["items"] = []): ConversationTurn =>
  ({ id, status, error: null, items, startedAtMs: null, completedAtMs: null, origin: "live" });
const compaction = (id: string, streaming: boolean): ConversationTurn["items"][number] =>
  ({ item: { type: "contextCompaction", id, status: "completed", tokensBefore: null, summary: null }, streaming } as ConversationTurn["items"][number]);

function withConversations(...conversations: Conversation[]): AppState {
  const state = createInitialState();
  state.bridge = { state: "connected", omo: null, userAgent: null, message: null, stderrTail: null, exitCode: null, restartAttempt: 0, installCommand: OMO_INSTALL_COMMAND };
  for (const conversation of conversations) state.conversations[conversation.threadId] = conversation;
  return state;
}

function conversation(threadId: string, turns: ConversationTurn[]): Conversation {
  return { ...emptyConversation(threadId), turns };
}

describe("pending requests per thread", () => {
  it("keeps the same array while the requests are unchanged and follows a change", () => {
    const state = createInitialState();
    const request = { kind: "userInput", id: 1, threadId: "a", params: {}, receivedAtMs: 1 } as unknown as PendingRequest;
    state.pendingRequests = [request, { ...request, id: 2, threadId: "b" } as PendingRequest];
    const first = selectPendingRequestsForThread(state, "a");
    expect(first).toEqual([request]);
    expect(selectPendingRequestsForThread({ ...state }, "a")).toBe(first);
    const changed = { ...state, pendingRequests: [...state.pendingRequests, { ...request, id: 3 } as PendingRequest] };
    expect(selectPendingRequestsForThread(changed, "a").map((entry) => entry.id)).toEqual([1, 3]);
    expect(selectPendingRequestsForThread(changed, "c")).toEqual([]);
  });
});

describe("completed turn counts", () => {
  it("counts completed turns across every conversation and follows a completion", () => {
    const a = conversation("a", [turn("1", "completed"), turn("2", "inProgress")]);
    const b = conversation("b", [turn("3", "completed")]);
    const state = withConversations(a, b);
    expect(selectCompletedTurnCount(state)).toBe(2);
    const streamed = { ...a, turns: [a.turns[0]!, turn("2", "inProgress", [compaction("x", true)])] };
    expect(selectCompletedTurnCount({ ...state, conversations: { ...state.conversations, a: streamed } })).toBe(2);
    const settled = { ...a, turns: [a.turns[0]!, turn("2", "completed")] };
    expect(selectCompletedTurnCount({ ...state, conversations: { ...state.conversations, a: settled } })).toBe(3);
  });

  it("counts a thread's completed turns and weighs streaming compactions 1 and finished ones 2", () => {
    const a = conversation("a", [turn("1", "completed", [compaction("c1", false)]), turn("2", "inProgress", [compaction("c2", true)])]);
    const state = withConversations(a);
    expect(selectCompletedCount(state, "a")).toBe(1);
    expect(selectCompactionCount(state, "a")).toBe(3);
    expect(selectCompactionCount(state, "missing")).toBe(0);
    expect(selectCompletedCount(state, null)).toBe(0);
  });
});

describe("sidebar running inputs", () => {
  it("changes only with what decides whether a thread runs, not with streamed output", () => {
    const a = conversation("a", [turn("1", "inProgress")]);
    a.activeTurnId = "1";
    a.live = { ...a.live, freshness: "live" };
    const state = withConversations(a);
    const key = runningInputsKey(state);
    const streamed = { ...a, turns: [turn("1", "inProgress", [compaction("x", true)])] };
    expect(runningInputsKey({ ...state, conversations: { a: streamed } })).toBe(key);
    const settled = { ...a, activeTurnId: null, turns: [turn("1", "completed")] };
    expect(runningInputsKey({ ...state, conversations: { a: settled } })).not.toBe(key);
    const tasked = { ...settled, live: { ...settled.live, tasks: { t: { task_id: "t", status: "running", description: "w" } as LiveTask } } };
    expect(runningInputsKey({ ...state, conversations: { a: tasked } })).not.toBe(runningInputsKey({ ...state, conversations: { a: settled } }));
    expect(runningInputsKey({ ...state, bridge: { ...state.bridge!, state: "restarting" } })).not.toBe(key);
  });

  it("gives the same running answer for every state with the same key", () => {
    const a = conversation("a", [turn("1", "inProgress")]);
    a.activeTurnId = "1";
    a.live = { ...a.live, freshness: "live" };
    const thread = { id: "a", cwd: "/w", name: null, preview: "", updatedAt: 0, status: { type: "active" as const, activeFlags: [] }, path: null, source: null };
    const state = withConversations(a);
    const streamed = withConversations({ ...a, turns: [turn("1", "inProgress", [compaction("x", true)])] });
    expect(runningInputsKey(streamed)).toBe(runningInputsKey(state));
    expect(isLiveRunning(thread, streamed)).toBe(isLiveRunning(thread, state));
  });
});
