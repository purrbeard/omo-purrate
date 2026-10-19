import type { AppState } from "./types";
import { pushNotice } from "./threads";

/** Extension event names the native bridge emits for omo's fire-and-forget UI methods (electron/omo/native/ui-bridge.ts). */
export const UI_EXTENSION_PREFIX = "omo-ui:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Applies `omo-ui:notify` (a thread-scoped toast) and `omo-ui:status` (the thread's status strip entries). */
export function applyUiExtension(state: AppState, threadId: string, name: string, data: unknown): AppState {
  if (!isRecord(data)) return state;
  if (name === "omo-ui:notify") {
    const { id, message, notifyType } = data;
    if (typeof id !== "string" || typeof message !== "string") return state;
    const level = notifyType === "error" ? "error" : notifyType === "warning" ? "warning" : "info";
    return pushNotice(state, { id: `ext-notify:${threadId}:${id}`, level, message, threadId });
  }
  if (name === "omo-ui:status") {
    const entries = isRecord(data["entries"]) ? Object.fromEntries(Object.entries(data["entries"]).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "")) : {};
    if (Object.keys(entries).length === 0) {
      if (state.extensionStatus[threadId] === undefined) return state;
      const { [threadId]: _cleared, ...rest } = state.extensionStatus;
      return { ...state, extensionStatus: rest };
    }
    return { ...state, extensionStatus: { ...state.extensionStatus, [threadId]: entries } };
  }
  return state;
}
