import { createReadStream } from "node:fs";
import { CLIENT_MESSAGE_PREFIX, ORIGIN_CONTEXT, ORIGIN_ENTRY } from "../../shared/session-origin";

const PROBE_MESSAGE_ID = /^(?:probe-owner|answer-probe):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DISCORD_MESSAGE_ID = /^discord:[0-9]+$/u;
const APP_MESSAGE_ID = new RegExp(`^${CLIENT_MESSAGE_PREFIX}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, "iu");

export type ProvenOrigin = "user" | "agent" | "dori";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Creation origin is decided before the first user message, not by later probe turns. */
export async function threadOrigin(lines: AsyncIterable<string> | Iterable<string>): Promise<ProvenOrigin | undefined> {
  let sessionId: string | undefined;
  for await (const line of lines) {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      if (error instanceof SyntaxError) continue; // Live JSONL writers can leave an incomplete last line.
      throw error;
    }
    if (!object(entry)) continue;
    if (entry["type"] === "message" && object(entry["message"]) && entry["message"]["role"] === "user") return undefined;
    if (entry["type"] === "session" && typeof entry["id"] === "string") sessionId = entry["id"];
    if (sessionId === undefined) continue;
    const origin = creationEvidence(entry, sessionId);
    if (origin !== undefined && origin !== "other") return origin;
  }
  return undefined;
}

/** What one record before the first user message proves about who opened the session; "other" is an admission from an unknown client. */
export function creationEvidence(entry: Record<string, unknown>, sessionId: string): ProvenOrigin | "other" | undefined {
  if (entry["type"] !== "custom") return undefined;
  const data = entry["data"];
  if (!object(data)) return undefined;
  if (entry["customType"] === ORIGIN_ENTRY) return data["createdBy"] === ORIGIN_CONTEXT.created_by ? "user" : undefined;
  if (entry["customType"] !== "rpc_client_message_admission" || data["durableSessionId"] !== sessionId) return undefined;
  const id = data["clientMessageId"];
  if (typeof id !== "string") return undefined;
  if (APP_MESSAGE_ID.test(id)) return "user";
  if (PROBE_MESSAGE_ID.test(id)) return "agent";
  if (DISCORD_MESSAGE_ID.test(id)) return "dori";
  return "other";
}

/** The IPC session resolver enforces the same realpath boundary as history loading. */
export async function loadThreadOrigins(
  paths: string[], resolveSessionFile: (sessionPath: string) => Promise<string>,
): Promise<Record<string, ProvenOrigin>> {
  const origins: Record<string, ProvenOrigin> = {};
  for (const sessionPath of new Set(paths)) {
    try {
      const input = createReadStream(await resolveSessionFile(sessionPath), { encoding: "utf8", highWaterMark: 4096 });
      try {
        const origin = await threadOrigin((async function* () {
          let buffer = "";
          for await (const chunk of input) {
            buffer += chunk;
            let end;
            while ((end = buffer.indexOf("\n")) !== -1) {
              const line = buffer.slice(0, end);
              buffer = buffer.slice(end + 1);
              yield line;
            }
          }
          if (buffer !== "") yield buffer;
        })());
        if (origin !== undefined) origins[sessionPath] = origin;
      } finally {
        input.destroy();
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) continue;
      throw error;
    }
  }
  return origins;
}
