import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Thread, ThreadStatus } from "../../../shared/protocol";
import { ARCHIVE_SUFFIX } from "../unarchive-fallback";

export interface SessionRecord {
  id: string;
  sessionPath: string;
  cwd: string;
  createdAtMs: number;
  updatedAtMs: number;
  name: string | null;
  preview: string | null;
  parentSession: string | null;
}

interface CacheEntry {
  size: number;
  mtimeMs: number;
  scanned: number;
  tail: string;
  record: SessionRecord | null;
}

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function userText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const text = content.flatMap((block) => (isRecord(block) && block["type"] === "text" && typeof block["text"] === "string" ? [block["text"]] : [])).join("\n");
  return text === "" ? null : text;
}

/** UUIDv7, the id shape omo gives sessions; it sorts by creation time like native ids do. */
export function uuidv7(nowMs = Date.now()): string {
  const bytes = randomBytes(16);
  const time = BigInt(nowMs);
  for (let index = 0; index < 6; index++) bytes[index] = Number((time >> BigInt(8 * (5 - index))) & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function applyLine(record: SessionRecord | null, line: string, sessionPath: string): SessionRecord | null {
  if (line.trim() === "") return record;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    // A live writer can leave a partial last line; the next scan reads it whole.
    void error;
    return record;
  }
  if (!isRecord(value)) return record;
  if (record === null) {
    if (value["type"] !== "session" || typeof value["id"] !== "string") return null;
    const created = typeof value["timestamp"] === "string" ? Date.parse(value["timestamp"]) : Number.NaN;
    return {
      id: value["id"],
      sessionPath,
      cwd: typeof value["cwd"] === "string" ? value["cwd"] : "",
      createdAtMs: Number.isNaN(created) ? 0 : created,
      updatedAtMs: 0,
      name: null,
      preview: null,
      parentSession: typeof value["parentSession"] === "string" ? value["parentSession"] : null,
    };
  }
  if (value["type"] === "session_info") {
    record.name = typeof value["name"] === "string" && value["name"].trim() !== "" ? value["name"] : null;
  } else if (record.preview === null && value["type"] === "message" && isRecord(value["message"]) && value["message"]["role"] === "user") {
    record.preview = userText(value["message"]["content"]);
  }
  return record;
}

async function readRange(file: string, start: number, end: number): Promise<string> {
  if (end <= start) return "";
  const chunks: string[] = [];
  const stream = createReadStream(file, { start, end: end - 1, encoding: "utf8", highWaterMark: 1 << 20 });
  for await (const chunk of stream) chunks.push(chunk as string);
  return chunks.join("");
}

/**
 * The thread list the removed app-server served, rebuilt from omo's session files: one record per
 * `<sessionsDir>/<cwd folder>/*.jsonl`, rescanning only the bytes appended since the last listing.
 */
export class SessionIndex {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(readonly sessionsDir: string) {}

  async list(): Promise<SessionRecord[]> {
    const files = await this.sessionFiles();
    const seen = new Set(files);
    for (const key of this.cache.keys()) if (!seen.has(key)) this.cache.delete(key);
    const records: SessionRecord[] = [];
    for (const file of files) {
      const record = await this.scan(file);
      if (record !== null) records.push(record);
    }
    return records.sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  }

  async find(threadId: string): Promise<SessionRecord | null> {
    for (const entry of this.cache.values()) {
      if (entry.record?.id === threadId) {
        const fresh = await this.scan(entry.record.sessionPath);
        if (fresh?.id === threadId) return fresh;
      }
    }
    return (await this.list()).find((record) => record.id === threadId) ?? null;
  }

  async isArchived(record: SessionRecord): Promise<boolean> {
    try {
      await stat(record.sessionPath + ARCHIVE_SUFFIX);
      return true;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return false;
      throw error;
    }
  }

  async archive(record: SessionRecord): Promise<void> {
    const thread = {
      id: record.id,
      sessionId: record.id,
      cwd: record.cwd,
      createdAt: new Date(record.createdAtMs).toISOString(),
      updatedAt: new Date(record.updatedAtMs).toISOString(),
      status: { type: "notLoaded" },
      preview: record.preview,
      name: record.name,
      sessionPath: record.sessionPath,
    };
    const target = record.sessionPath + ARCHIVE_SUFFIX;
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ archivedAt: new Date().toISOString(), thread })}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  }

  /** Bumps the session file's mtime so the restored thread sorts as recent, then drops the sidecar. */
  async unarchive(record: SessionRecord, nowMs = Date.now()): Promise<void> {
    const session = await stat(record.sessionPath);
    await utimes(record.sessionPath, session.atime, new Date(Math.max(nowMs, session.mtimeMs + 1)));
    await rm(record.sessionPath + ARCHIVE_SUFFIX, { force: true });
    this.cache.delete(record.sessionPath);
  }

  async remove(record: SessionRecord): Promise<void> {
    await rm(record.sessionPath + ARCHIVE_SUFFIX, { force: true });
    await rm(record.sessionPath, { force: true });
    this.cache.delete(record.sessionPath);
  }

  /** Copies a session into a new file with a fresh header id that names the source as its parent. */
  async fork(record: SessionRecord, cwd: string, nowMs = Date.now()): Promise<string> {
    const text = await readFile(record.sessionPath, "utf8");
    const newline = text.indexOf("\n");
    const headerLine = newline === -1 ? text : text.slice(0, newline);
    const header: unknown = JSON.parse(headerLine);
    if (!isRecord(header) || header["type"] !== "session") throw new Error(`not an omo session file: ${record.sessionPath}`);
    const id = uuidv7(nowMs);
    const timestamp = new Date(nowMs).toISOString();
    const forked = { ...header, id, timestamp, cwd, parentSession: record.sessionPath };
    const directory = path.dirname(record.sessionPath);
    const target = path.join(directory, `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`);
    await mkdir(directory, { recursive: true });
    const handle = await open(target, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(forked)}\n${newline === -1 ? "" : text.slice(newline + 1)}`, "utf8");
    } finally {
      await handle.close();
    }
    return target;
  }

  toThread(record: SessionRecord, status: ThreadStatus): Thread {
    return {
      id: record.id,
      sessionId: record.id,
      preview: record.preview ?? "",
      createdAt: record.createdAtMs / 1000,
      updatedAt: record.updatedAtMs / 1000,
      status,
      path: record.sessionPath,
      cwd: record.cwd,
      name: record.name,
      turns: [],
    };
  }

  private async sessionFiles(): Promise<string[]> {
    let folders: string[];
    try {
      folders = await readdir(this.sessionsDir);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return [];
      throw error;
    }
    const files: string[] = [];
    for (const folder of folders) {
      // omo nests sessions under a cwd folder; a session file passed to `--session` may also sit at the top.
      if (folder.endsWith(".jsonl")) {
        files.push(path.join(this.sessionsDir, folder));
        continue;
      }
      const directory = path.join(this.sessionsDir, folder);
      let names: string[];
      try {
        names = await readdir(directory);
      } catch (error) {
        if (errorCode(error) === "ENOTDIR" || errorCode(error) === "ENOENT") continue;
        throw error;
      }
      for (const name of names) if (name.endsWith(".jsonl")) files.push(path.join(directory, name));
    }
    return files;
  }

  private async scan(file: string): Promise<SessionRecord | null> {
    let info: { size: number; mtimeMs: number };
    try {
      info = await stat(file);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        this.cache.delete(file);
        return null;
      }
      throw error;
    }
    let entry = this.cache.get(file);
    if (entry !== undefined && entry.size === info.size && entry.mtimeMs === info.mtimeMs) return entry.record;
    if (entry === undefined || info.size < entry.scanned) {
      entry = { size: 0, mtimeMs: 0, scanned: 0, tail: "", record: null };
    }
    const text = entry.tail + await readRange(file, entry.scanned, info.size);
    const lastNewline = text.lastIndexOf("\n");
    const complete = lastNewline === -1 ? "" : text.slice(0, lastNewline);
    let record = entry.record === null ? null : { ...entry.record };
    for (const line of complete.split("\n")) record = applyLine(record, line, file);
    const tail = lastNewline === -1 ? text : text.slice(lastNewline + 1);
    if (record !== null) record.updatedAtMs = info.mtimeMs;
    this.cache.set(file, { size: info.size, mtimeMs: info.mtimeMs, scanned: info.size, tail, record });
    return record;
  }
}
