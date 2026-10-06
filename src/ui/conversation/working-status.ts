import type { ConversationTurn } from "../../state";

/** Silence after which the working line also says when omo last produced anything. */
export const QUIET_AFTER_MS = 30_000;

/** A user message this soon after the turn started is the turn's own prompt; a later one was sent into the running turn. */
const OPENING_PROMPT_WINDOW_MS = 1_000;

export interface WorkingStatus {
  /** Time since the running turn started. */
  elapsedMs: number;
  /** Time since the turn's newest item started or finished; equals elapsedMs before the first item. */
  idleMs: number;
  /**
   * True when the newest item is a message the user sent into the already running turn. omo reads such a message
   * only when its current step (often a long model call that streams nothing) finishes.
   */
  queuedMessage: boolean;
}

/** Describes a running turn for the working line, as of `nowMs`. */
export function workingStatus(turn: ConversationTurn, nowMs: number): WorkingStatus {
  const startedAtMs = turn.startedAtMs ?? nowMs;
  let lastActivityMs = startedAtMs;
  for (const entry of turn.items) {
    for (const at of [entry.startedAtMs, entry.completedAtMs]) if (at !== null && at > lastActivityMs) lastActivityMs = at;
  }
  const last = turn.items.at(-1);
  const arrivedAtMs = last?.startedAtMs ?? last?.completedAtMs ?? null;
  const steered = last?.item.type === "userMessage" && arrivedAtMs !== null && arrivedAtMs - startedAtMs > OPENING_PROMPT_WINDOW_MS;
  return {
    elapsedMs: Math.max(0, nowMs - startedAtMs),
    idleMs: Math.max(0, nowMs - lastActivityMs),
    queuedMessage: steered,
  };
}

/** Splits a duration into whole minutes and remaining seconds. */
export function durationParts(ms: number): { minutes: number; seconds: number } {
  const total = Math.floor(ms / 1000);
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}
