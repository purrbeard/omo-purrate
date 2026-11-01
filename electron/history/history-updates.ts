import { createHash, randomUUID } from "node:crypto";
import type { HistoryResult, HistoryTurn, HistoryUpdate } from "../../shared/ipc";

/** Sessions whose last read is remembered; a reader of any other session receives every turn. */
const REMEMBERED = 8;

interface Read {
  token: string;
  turnDigests: string[];
  history: WeakRef<HistoryResult>;
  fullFrom: number;
}

/** Longest string an outlined turn keeps; tool output beyond it is what makes a long session heavy. */
const OUTLINE_STRING = 2_000;
/** Kept whole: edited-file lists and diffs are built from them. */
const WHOLE_FIELDS = new Set(["changes", "arguments"]);

function trimmed(value: unknown): unknown {
  if (typeof value === "string") return value.length > OUTLINE_STRING ? `${value.slice(0, OUTLINE_STRING)}…` : value;
  if (Array.isArray(value)) return value.map(trimmed);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, WHOLE_FIELDS.has(key) ? field : trimmed(field)]));
}

/** Keep prompts whole for editing and recall; only generated output is outlined. */
function outline(turn: HistoryTurn): HistoryTurn {
  return { ...turn, items: turn.items.map((item) => item.type === "userMessage" ? item : trimmed(item) as HistoryTurn["items"][number]) };
}

/**
 * Remembers each session's last read as per-turn digests of what was sent, so a reread sends the renderer only the run
 * of turns that differs from that read (an append, an edit, outlines replaced by full turns) instead of cloning the
 * whole history across IPC again. Turns before `fullFrom` are sent as outlines; a negative `fullFrom` counts from the end.
 */
export class HistoryUpdates {
  private readonly reads = new Map<string, Read>();

  update(sessionPath: string, history: HistoryResult, since: string | null, fullFrom = 0): HistoryUpdate {
    const total = history.turns.length;
    const full = Math.min(total, Math.max(0, fullFrom < 0 ? total + fullFrom : fullFrom));
    const previous = this.reads.get(sessionPath);
    const same = previous?.history.deref() === history && previous.fullFrom === full;
    const sent = same ? history.turns : history.turns.map((turn, index) => (index < full ? outline(turn) : turn));
    const digests = same ? previous.turnDigests
      : sent.map((turn) => createHash("sha1").update(JSON.stringify(turn)).digest("base64"));
    const base = previous !== undefined && since !== null && previous.token === since ? since : null;
    const known = base === null ? [] : previous!.turnDigests;
    let from = 0;
    while (from < known.length && from < total && known[from] === digests[from]) from += 1;
    let suffix = 0;
    while (suffix < known.length - from && suffix < total - from && known[known.length - 1 - suffix] === digests[total - 1 - suffix]) suffix += 1;
    const token = randomUUID();
    this.reads.delete(sessionPath);
    this.reads.set(sessionPath, { token, turnDigests: digests, history: new WeakRef(history), fullFrom: full });
    if (this.reads.size > REMEMBERED) this.reads.delete(this.reads.keys().next().value as string);
    const { turns: _turns, ...rest } = history;
    const changed = sent.slice(from, total - suffix);
    return { ...rest, token, base, from, removed: known.length - from - suffix, turns: same ? changed.map((turn, index) => from + index < full ? outline(turn) : turn) : changed, total, fullFrom: full };
  }
}
