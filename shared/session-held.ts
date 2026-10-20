/** A process outside this app's omo family that has a session's JSONL open (omo `session_held` refusal / holder record). */
export interface SessionHolder {
  pid: number;
  cwd?: string;
  hostSocket?: string;
  hostInstance?: string;
}

/** omo's `errorCode` when another live process holds the session. */
export const SESSION_HELD_CODE = "session_held";

const MARKER = `${SESSION_HELD_CODE}:`;
const ENCODED = new RegExp(`(?:^|: )${MARKER}(\\{[\\s\\S]*\\})$`);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @returns the valid holders of an omo `errorData` / holder list (entries without a numeric pid are dropped) */
export function normalizeHolders(value: unknown): SessionHolder[] {
  const list = isRecord(value) ? value["holders"] : value;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry): SessionHolder[] => {
    if (!isRecord(entry) || typeof entry["pid"] !== "number" || !Number.isFinite(entry["pid"])) return [];
    const holder: SessionHolder = { pid: entry["pid"] };
    if (typeof entry["cwd"] === "string") holder.cwd = entry["cwd"];
    const socket = entry["host_socket"] ?? entry["hostSocket"];
    if (typeof socket === "string") holder.hostSocket = socket;
    const instance = entry["host_instance"] ?? entry["hostInstance"];
    if (typeof instance === "string") holder.hostInstance = instance;
    return [holder];
  });
}

/**
 * The message a `session_held` refusal carries across the Electron IPC bridge, which keeps only `message`:
 * a stable marker followed by the holders as JSON. `parseSessionHeld` is its inverse.
 */
export function sessionHeldMessage(errorData: unknown): string {
  return `${MARKER}${JSON.stringify({ holders: normalizeHolders(errorData) })}`;
}

/** @returns the holders encoded in an error message (any RPC-code prefix is ignored), or null when it is not a session_held refusal */
export function parseSessionHeld(message: string): SessionHolder[] | null {
  const match = ENCODED.exec(message);
  if (match === null) return null;
  try {
    return normalizeHolders(JSON.parse(match[1]!));
  } catch {
    return null;
  }
}

/** @returns the holder as "pid 123, P:\\work" for lists and tooltips */
export function describeHolder(holder: SessionHolder): string {
  return holder.cwd === undefined ? `pid ${holder.pid}` : `pid ${holder.pid}, ${holder.cwd}`;
}
