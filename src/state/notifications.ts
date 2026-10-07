import type { ThreadItem } from "../../shared/protocol";
import {
  appendAt,
  ensureTurn,
  findItem,
  fromWireTurn,
  settleActiveTurn,
  settlePendingMessage,
  stopStreaming,
  toMs,
  toSummary,
  updateConversation,
  updateExistingConversation,
  updateItem,
  updateTurn,
  upsertItem,
  wireItems,
} from "./conversation";
import { dropRequest, fillEmptyPreview, pushNotice, removeThread, updateThread, upsertThread } from "./threads";
import type { AppState, Conversation, ConversationItem } from "./types";
import type { ServerNotification } from "./wire";
import { invalidateSkillCatalogs } from "./skills";
import { applyLiveExtension } from "./live";
import { forgetThread, holdPendingSide } from "./btw";

interface ItemPlacement {
  threadId: string;
  turnId: string;
  item: ThreadItem;
  receivedAtMs: number;
}

function placeItem(state: AppState, placement: ItemPlacement, completedAtMs: number | null, startedAtMs: number): AppState {
  const { threadId, turnId, item, receivedAtMs } = placement;
  return updateConversation(state, threadId, (conversation) => {
    const placed = updateTurn(ensureTurn(conversation, turnId, receivedAtMs), turnId, (turn) =>
      upsertItem(turn, {
        item,
        streaming: completedAtMs === null,
        startedAtMs: findItem(turn, item.id)?.startedAtMs ?? (completedAtMs === null ? startedAtMs : null),
        completedAtMs,
      }),
    );
    return item.type === "userMessage" ? settlePendingMessage(placed, item) : placed;
  });
}

function previewFromUserItem(state: AppState, threadId: string, item: ThreadItem): AppState {
  if (item.type !== "userMessage") return state;
  return fillEmptyPreview(state, threadId, item.content.map((part) => (part.type === "text" ? part.text : "")).join(""));
}

function editItem(
  state: AppState,
  target: { threadId: string; turnId: string; itemId: string },
  edit: (entry: ConversationItem) => ConversationItem,
): AppState {
  return updateConversation(state, target.threadId, (conversation) =>
    updateTurn(conversation, target.turnId, (turn) => updateItem(turn, target.itemId, edit)),
  );
}

function appendAgentText(state: AppState, target: { threadId: string; turnId: string; itemId: string; delta: string }, receivedAtMs: number): AppState {
  return updateConversation(state, target.threadId, (conversation) =>
    updateTurn(ensureTurn(conversation, target.turnId, receivedAtMs), target.turnId, (turn) => {
      const existing = findItem(turn, target.itemId);
      if (existing === undefined) {
        const item: ThreadItem = { type: "agentMessage", id: target.itemId, text: target.delta, phase: null };
        return upsertItem(turn, { item, streaming: true, startedAtMs: receivedAtMs, completedAtMs: null });
      }
      const item = existing.item;
      return item.type === "agentMessage"
        ? updateItem(turn, target.itemId, (entry) => ({ ...entry, item: { ...item, text: item.text + target.delta } }))
        : turn;
    }),
  );
}

function completeTurn(conversation: Conversation, notification: Extract<ServerNotification, { method: "turn/completed" }>, receivedAtMs: number): Conversation {
  const wireTurn = notification.params.turn;
  const known = conversation.turns.some((turn) => turn.id === wireTurn.id);
  const withTurn = known ? conversation : { ...conversation, turns: [...conversation.turns, fromWireTurn(wireTurn, receivedAtMs)] };
  const finished = updateTurn(withTurn, wireTurn.id, (turn) => ({
    ...turn,
    status: wireTurn.status,
    error: wireTurn.error ?? null,
    completedAtMs: toMs(wireTurn.completedAt) ?? receivedAtMs,
    items: turn.items.length === 0 ? wireItems(wireTurn.items, false) : stopStreaming(turn.items),
  }));
  return finished.activeTurnId === wireTurn.id ? { ...finished, activeTurnId: null } : finished;
}

export function applyNotification(state: AppState, notification: ServerNotification, receivedAtMs: number): AppState {
  switch (notification.method) {
    case "mcpServer/startupStatus/updated":
      return state; // Actions refetch the inventory; the unconfirmed payload is not state.
    case "thread/goal/updated":
    case "thread/goal/cleared": {
      const { threadId } = notification.params;
      const goal = notification.method === "thread/goal/updated" ? notification.params.goal : null;
      return updateConversation(state, threadId, (conversation) => ({
        ...conversation, live: { ...conversation.live, goal, goalRevision: conversation.live.goalRevision + 1 },
      }));
    }
    case "skills/changed":
      return invalidateSkillCatalogs(state);
    case "thread/started": {
      const summary = toSummary(notification.params.thread);
      const known = state.threads[summary.id] !== undefined;
      const listed = upsertThread(state, summary);
      return known ? listed : holdPendingSide(listed, summary);
    }
    case "thread/status/changed": {
      const { threadId, status } = notification.params;
      const listed = updateThread(state, threadId, (summary) => ({ ...summary, status }));
      return status.type === "active"
        ? listed
        : updateExistingConversation(listed, threadId, (conversation) => settleActiveTurn(conversation, "completed", receivedAtMs));
    }
    case "thread/name/updated": {
      const { threadId, threadName } = notification.params;
      return updateThread(state, threadId, (summary) => ({ ...summary, name: threadName ?? null }));
    }
    case "thread/archived":
    case "thread/deleted":
      return forgetThread(removeThread(state, notification.params.threadId), notification.params.threadId);
    case "turn/started": {
      const { threadId, turn } = notification.params;
      return updateConversation(state, threadId, (conversation) => {
        const known = conversation.turns.some((existing) => existing.id === turn.id);
        const turns = known ? conversation.turns : [...conversation.turns, fromWireTurn(turn, receivedAtMs)];
        const activeTurnId = turn.status === "inProgress" ? turn.id : conversation.activeTurnId;
        return known && activeTurnId === conversation.activeTurnId ? conversation : { ...conversation, turns, activeTurnId };
      });
    }
    case "item/started": {
      const { startedAtMs, ...placement } = notification.params;
      const placed = placeItem(state, { ...placement, receivedAtMs }, null, startedAtMs ?? receivedAtMs);
      return previewFromUserItem(placed, placement.threadId, placement.item);
    }
    case "item/completed": {
      const { completedAtMs, ...placement } = notification.params;
      const placed = placeItem(state, { ...placement, receivedAtMs }, completedAtMs ?? receivedAtMs, receivedAtMs);
      return previewFromUserItem(placed, placement.threadId, placement.item);
    }
    case "item/agentMessage/delta":
      return appendAgentText(state, notification.params, receivedAtMs);
    case "item/reasoning/textDelta": {
      const { delta, contentIndex } = notification.params;
      return editItem(state, notification.params, (entry) =>
        entry.item.type === "reasoning"
          ? { ...entry, item: { ...entry.item, content: appendAt(entry.item.content, contentIndex, delta) } }
          : entry,
      );
    }
    case "item/reasoning/summaryTextDelta": {
      const { delta, summaryIndex } = notification.params;
      return editItem(state, notification.params, (entry) =>
        entry.item.type === "reasoning"
          ? { ...entry, item: { ...entry.item, summary: appendAt(entry.item.summary, summaryIndex, delta) } }
          : entry,
      );
    }
    case "item/commandExecution/outputDelta": {
      const { delta } = notification.params;
      return editItem(state, notification.params, (entry) =>
        entry.item.type === "commandExecution"
          ? { ...entry, item: { ...entry.item, aggregatedOutput: (entry.item.aggregatedOutput ?? "") + delta } }
          : entry,
      );
    }
    case "turn/completed": {
      const { threadId } = notification.params;
      const completed = updateConversation(state, threadId, (conversation) =>
        completeTurn(conversation, notification, receivedAtMs),
      );
      return updateThread(completed, threadId, (summary) => ({ ...summary, updatedAt: receivedAtMs }));
    }
    case "error": {
      const { error, willRetry, threadId, turnId } = notification.params;
      const withError = updateConversation(state, threadId, (conversation) =>
        updateTurn(conversation, turnId, (turn) => ({ ...turn, error })),
      );
      if (willRetry) return withError;
      return pushNotice(withError, {
        id: `turn-error:${threadId}:${turnId}:${receivedAtMs}`,
        level: "error",
        message: error.message,
        threadId,
      });
    }
    case "serverRequest/resolved": {
      const request = state.pendingRequests.find((pending) => pending.id === notification.params.requestId);
      // Non-blocking questions are cancelled by omo on agent_end, even without an answer.
      // Keep their form and submit a follow-up message instead of answering an expired RPC.
      if (request?.kind === "userInput" && request.params.waitForAnswer === false) {
        return { ...state, pendingRequests: state.pendingRequests.map((pending) => pending === request ? { ...request, resolved: true } : pending) };
      }
      return dropRequest(state, notification.params.requestId);
    }
    case "extension_event":
      return applyLiveExtension(state, notification.params.threadId, notification.params.name, notification.params.data);
  }
}
