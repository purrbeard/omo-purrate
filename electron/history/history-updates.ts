import { createHash, randomUUID } from "node:crypto";
import type { HistoryResult, HistoryTurn, HistoryUpdate } from "../../shared/ipc";

/** Sessions whose last read is remembered; a reader of any other session receives every turn. */
const REMEMBERED = 8;

interface Read {
  token: string;
  turnDigests: string[];
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

/** A turn with every item but its long strings cut: it still lists, previews and counts like the full turn. */
function outline(turn: HistoryTurn): HistoryTurn {
  return { ...turn, items: turn.items.map((item) => trimmed(item) as HistoryTurn["items"][number]) };
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
    const sent = history.turns.map((turn, index) => (index < full ? outline(turn) : turn));
    const digests = sent.map((turn) => createHash("sha1").update(JSON.stringify(turn)).digest("base64"));
    const previous = this.reads.get(sessionPath);
    const base = previous !== undefined && since !== null && previous.token === since ? since : null;
    const known = base === null ? [] : previous!.turnDigests;
    let from = 0;
    while (from < known.length && from < total && known[from] === digests[from]) from += 1;
    let suffix = 0;
    while (suffix < known.length - from && suffix < total - from && known[known.length - 1 - suffix] === digests[total - 1 - suffix]) suffix += 1;
    const token = randomUUID();
    this.reads.delete(sessionPath);
    this.reads.set(sessionPath, { token, turnDigests: digests });
    if (this.reads.size > REMEMBERED) this.reads.delete(this.reads.keys().next().value as string);
    const { turns: _turns, ...rest } = history;
    return { ...rest, token, base, from, removed: known.length - from - suffix, turns: sent.slice(from, total - suffix), total, fullFrom: full };
  }
}
