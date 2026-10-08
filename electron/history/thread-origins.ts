import { createReadStream } from "node:fs";

const PROBE_MESSAGE_ID = /^(?:probe-owner|answer-probe):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DISCORD_MESSAGE_ID = /^discord:[0-9]+$/u;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Creation origin is decided before the first user message, not by later probe turns. */
export async function threadOrigin(lines: AsyncIterable<string> | Iterable<string>): Promise<"agent" | "dori" | undefined> {
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
    if (sessionId === undefined || entry["type"] !== "custom" || entry["customType"] !== "rpc_client_message_admission") continue;
    const data = entry["data"];
    if (object(data) && data["durableSessionId"] === sessionId && typeof data["clientMessageId"] === "string" &&
      PROBE_MESSAGE_ID.test(data["clientMessageId"])) return "agent";
    if (object(data) && data["durableSessionId"] === sessionId && typeof data["clientMessageId"] === "string" &&
      DISCORD_MESSAGE_ID.test(data["clientMessageId"])) return "dori";
  }
  return undefined;
}

/** The IPC session resolver enforces the same realpath boundary as history loading. */
export async function loadThreadOrigins(
  paths: string[], resolveSessionFile: (sessionPath: string) => Promise<string>,
): Promise<Record<string, "agent" | "dori">> {
  const origins: Record<string, "agent" | "dori"> = {};
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
