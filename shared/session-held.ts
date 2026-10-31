/** A foreign native writer discovered from its lease record or a session_held refusal. */
export interface SessionHolder {
  pid: number;
  cwd?: string;
  hostSocket?: string;
  hostInstance?: string;
  processStartedAtMs?: number;
  bootAtMs?: number;
  /** Only a stable lease read plus a matching live process can authorize endpoint discovery. */
  identity?: "verified" | "unverified";
  endpointKind?: "rpc_host" | "tui";
}

export const SESSION_HELD_CODE = "session_held";
const MARKER = `${SESSION_HELD_CODE}:`;
const ENCODED = new RegExp(`(?:^|: )${MARKER}(\\{[\\s\\S]*\\})$`);
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Normalizes discovery metadata; a native refusal without identity metadata is not a verified endpoint. */
export function normalizeHolders(value: unknown): SessionHolder[] {
  const list = isRecord(value) ? value["holders"] : value;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry): SessionHolder[] => {
    if (!isRecord(entry) || typeof entry["pid"] !== "number" || !Number.isSafeInteger(entry["pid"]) || entry["pid"] <= 0) return [];
    const holder: SessionHolder = { pid: entry["pid"] };
    if (typeof entry["cwd"] === "string") holder.cwd = entry["cwd"];
    const socket = entry["host_socket"] ?? entry["hostSocket"];
    if (typeof socket === "string") holder.hostSocket = socket;
    const instance = entry["host_instance"] ?? entry["hostInstance"];
    if (typeof instance === "string") holder.hostInstance = instance;
    if (typeof entry["processStartedAtMs"] === "number" && Number.isFinite(entry["processStartedAtMs"])) holder.processStartedAtMs = entry["processStartedAtMs"];
    if (typeof entry["bootAtMs"] === "number" && Number.isFinite(entry["bootAtMs"])) holder.bootAtMs = entry["bootAtMs"];
    if (entry["identity"] === "verified" || entry["identity"] === "unverified") holder.identity = entry["identity"];
    if (entry["endpointKind"] === "rpc_host" || entry["endpointKind"] === "tui") holder.endpointKind = entry["endpointKind"];
    return [holder];
  });
}

export function sessionHeldMessage(errorData: unknown): string {
  return `${MARKER}${JSON.stringify({ holders: normalizeHolders(errorData) })}`;
}
export function parseSessionHeld(message: string): SessionHolder[] | null {
  const match = ENCODED.exec(message);
  if (match === null) return null;
  try { return normalizeHolders(JSON.parse(match[1]!)); } catch { return null; }
}
export function describeHolder(holder: SessionHolder): string {
  return [`pid ${holder.pid}`, holder.cwd, holder.endpointKind, holder.hostSocket].filter(value => value !== undefined).join(", ");
}
