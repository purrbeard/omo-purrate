import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BranchPoint, BranchResult } from "../../shared/ipc";

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Text inputs of a user message joined with "\n"; images are ignored. */
export function userMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is JsonObject => isRecord(block) && block["type"] === "text" && typeof block["text"] === "string")
    .map((block) => block["text"] as string)
    .join("\n");
}

/** A version 7 UUID, the id format omo gives sessions. */
export function uuidv7(nowMs: number = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(nowMs, 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Resolve a native user entry on the selected branch without rewriting its session. */
export function retryEntryId(source: string, point: BranchPoint): string {
  const entries = new Map<string, JsonObject>();
  let leafId: string | null = null;
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const entry: unknown = JSON.parse(line);
    if (isRecord(entry) && typeof entry["id"] === "string" && entry["type"] !== "session") {
      entries.set(entry["id"], entry);
      leafId = entry["id"];
    }
  }
  const branch: JsonObject[] = [];
  for (let id = leafId; id !== null;) {
    const entry = entries.get(id);
    if (!entry) break;
    branch.push(entry);
    id = typeof entry["parentId"] === "string" ? entry["parentId"] : null;
  }
  let occurrence = 0;
  for (const entry of branch.reverse()) {
    const message = entry["message"];
    if (entry["type"] === "message" && isRecord(message) && message["role"] === "user" && userMessageText(message["content"]) === point.text) {
      if (occurrence++ === point.occurrence) return entry["id"] as string;
    }
  }
  throw new Error("the user message is not in this session's active branch");
}

/**
 * Builds a new session whose history is the source session's active branch up to, but excluding, the user message at
 * `point`. Mirrors omo's own branched sessions: label entries are dropped, parentId is re-chained over the kept entries,
 * and the header names the source in `parentSession`. Throws when the source has no header or no matching message.
 */
export function branchSessionText(source: string, sourcePath: string, point: BranchPoint, threadId: string, now: Date): string {
  const lines = source.split("\n").filter((line) => line.trim() !== "");
  const parsed: JsonObject[] = [];
  for (const line of lines) {
    try {
      const value: unknown = JSON.parse(line);
      if (isRecord(value)) parsed.push(value);
    } catch (error) {
      // A live session file can end in a partially written line; it is never part of the branch.
      void error;
    }
  }
  const header = parsed[0];
  if (header === undefined || header["type"] !== "session") throw new Error("the session file has no session header");
  const entries = new Map<string, JsonObject>();
  let leafId: string | null = null;
  for (const entry of parsed.slice(1)) {
    if (typeof entry["id"] !== "string") continue;
    entries.set(entry["id"], entry);
    leafId = entry["id"];
  }
  const branch: JsonObject[] = [];
  const seen = new Set<string>();
  for (let cursor = leafId; cursor !== null && !seen.has(cursor); ) {
    seen.add(cursor);
    const entry = entries.get(cursor);
    if (entry === undefined) break;
    branch.push(entry);
    cursor = typeof entry["parentId"] === "string" ? entry["parentId"] : null;
  }
  branch.reverse();

  let remaining = point.occurrence;
  const cut = branch.findIndex((entry) => {
    const message = entry["message"];
    if (entry["type"] !== "message" || !isRecord(message) || message["role"] !== "user") return false;
    if (userMessageText(message["content"]) !== point.text) return false;
    return remaining-- === 0;
  });
  if (cut < 0) throw new Error("the message to branch from is not in this session; reopen the thread and try again");

  let parentId: string | null = null;
  const kept: string[] = [];
  for (const entry of branch.slice(0, cut)) {
    if (entry["type"] === "label") continue;
    kept.push(JSON.stringify({ ...entry, parentId }));
    parentId = entry["id"] as string;
  }
  const newHeader = { ...header, id: threadId, timestamp: now.toISOString(), parentSession: sourcePath };
  return [JSON.stringify(newHeader), ...kept].join("\n") + "\n";
}

/** Writes the branch of `sourcePath` at `point` beside it as `<timestamp>_<id>.jsonl` and resolves the new session. */
export async function branchSession(sourcePath: string, point: BranchPoint, now: Date = new Date()): Promise<BranchResult> {
  const threadId = uuidv7(now.getTime());
  const text = branchSessionText(await readFile(sourcePath, "utf8"), sourcePath, point, threadId, now);
  const target = path.join(path.dirname(sourcePath), `${now.toISOString().replace(/[:.]/g, "-")}_${threadId}.jsonl`);
  await writeFile(target, text, { flag: "wx" });
  return { threadId, path: target };
}
