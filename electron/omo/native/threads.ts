import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Thread, ThreadStatus } from "../../../shared/protocol";
import { creationEvidence } from "../../history/thread-origins";
import { ARCHIVE_SUFFIX } from "../unarchive-fallback";

export type SessionDefect = "malformed_line" | "duplicate_entry_id" | "unknown_parent" | "unsupported_version";
/** Who opened the session, from the records before its first user message ("terminal": typed with no client admission). */
export type CreationEvidence = "app" | "automation" | "other-client" | "terminal";

export interface SessionFacts {
  userMessages: number;
  sizeBytes: number;
  defects: SessionDefect[];
  evidence: CreationEvidence | null;
}

const SUPPORTED_SESSION_VERSION = 3;

export interface SessionRecord {
  id: string;
  sessionPath: string;
  cwd: string;
  createdAtMs: number;
  updatedAtMs: number;
  name: string | null;
  preview: string | null;
  parentSession: string | null;
  facts: SessionFacts;
  /** Set for a session read from OmO (Alpha)'s own store rather than omo's sessions directory. */
  source?: "alpha";
}

interface CacheEntry {
  size: number;
  mtimeMs: number;
  scanned: number;
  tail: string;
  record: SessionRecord | null;
  entryIds: Set<string>;
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

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** omo's per-cwd session folder name: `P:\\coding\\app` becomes `--P--coding-app--`. */
export function sessionFolder(cwd: string): string {
  return `--${cwd.replace(/[\\/:]/g, "-")}--`;
}

/** OmO (Alpha) writes a header-only file and then a continuation file under one id; the one with the conversation wins. */
function better(left: SessionRecord, right: SessionRecord): SessionRecord {
  if (left.facts.userMessages !== right.facts.userMessages) return left.facts.userMessages > right.facts.userMessages ? left : right;
  return newestFirst(left, right) <= 0 ? left : right;
}

/** Newest first; equal times order by path so a keyset cursor over the list is total. */
export function newestFirst(left: SessionRecord, right: SessionRecord): number {
  return right.updatedAtMs - left.updatedAtMs || (left.sessionPath < right.sessionPath ? -1 : left.sessionPath > right.sessionPath ? 1 : 0);
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

function addDefect(record: SessionRecord, defect: SessionDefect): void {
  if (!record.facts.defects.includes(defect)) record.facts.defects.push(defect);
}

/** Applies one complete line; the scan holds a partial last line back, so a line that does not parse is damage. */
function applyLine(record: SessionRecord | null, line: string, sessionPath: string, entryIds: Set<string>): SessionRecord | null {
  if (line.trim() === "") return record;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    void error;
    if (record !== null) addDefect(record, "malformed_line");
    return record;
  }
  if (!isRecord(value)) {
    if (record !== null) addDefect(record, "malformed_line");
    return record;
  }
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
      facts: {
        userMessages: 0,
        sizeBytes: 0,
        defects: typeof value["version"] === "number" && value["version"] > SUPPORTED_SESSION_VERSION ? ["unsupported_version"] : [],
        evidence: null,
      },
    };
  }
  const parentId = value["parentId"];
  if (typeof parentId === "string" && !entryIds.has(parentId)) addDefect(record, "unknown_parent");
  if (typeof value["id"] === "string") {
    if (entryIds.has(value["id"])) addDefect(record, "duplicate_entry_id");
    entryIds.add(value["id"]);
  }
  const isUserMessage = value["type"] === "message" && isRecord(value["message"]) && value["message"]["role"] === "user";
  if (isUserMessage) record.facts.userMessages += 1;
  if (record.facts.evidence === null) {
    const proven = isUserMessage ? undefined : creationEvidence(value, record.id);
    record.facts.evidence = isUserMessage ? "terminal" : proven === "user" ? "app" : proven === "agent" || proven === "dori" ? "automation"
      : proven === "other" ? "other-client" : null;
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
 * `<sessionsDir>/<cwd folder>/*.jsonl`, rescanning only the bytes appended since the last listing. `extraDirs` adds
 * OmO (Alpha)'s session stores, read with the same layout; one id appearing in several files is listed once.
 */
export class SessionIndex {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(readonly sessionsDir: string, private readonly extraDirs: () => readonly string[] = () => []) {}

  async list(): Promise<SessionRecord[]> {
    const files = await this.sessionFiles();
    const seen = new Set(files);
    for (const key of this.cache.keys()) if (!seen.has(key)) this.cache.delete(key);
    const byId = new Map<string, SessionRecord>();
    for (const file of files) {
      const record = await this.scan(file);
      if (record === null) continue;
      const current = byId.get(record.id);
      byId.set(record.id, current === undefined ? record : better(current, record));
    }
    return [...byId.values()].sort(newestFirst);
  }

  async find(threadId: string): Promise<SessionRecord | null> {
    let found: SessionRecord | null = null;
    for (const entry of [...this.cache.values()]) {
      if (entry.record?.id === threadId) {
        const fresh = await this.scan(entry.record.sessionPath);
        if (fresh?.id === threadId) found = found === null ? fresh : better(found, fresh);
      }
    }
    return found ?? (await this.list()).find((record) => record.id === threadId) ?? null;
  }

  /** A session file outside omo's own sessions directory belongs to another app's store. */
  isExternal(record: Pick<SessionRecord, "sessionPath">): boolean {
    return !inside(this.sessionsDir, record.sessionPath);
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
    if (this.isExternal(record)) throw new Error("OmO (Alpha) owns this session file; archive the thread instead of deleting it");
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
    // A fork of an Alpha session is this app's own session: it goes to omo's sessions directory, never into Alpha's store.
    const directory = this.isExternal(record) ? path.join(this.sessionsDir, sessionFolder(cwd)) : path.dirname(record.sessionPath);
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

  toThread(record: Omit<SessionRecord, "facts">, status: ThreadStatus): Thread {
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
    const files: string[] = [];
    for (const root of [this.sessionsDir, ...this.extraDirs()]) files.push(...await this.rootFiles(root));
    return files;
  }

  private async rootFiles(root: string): Promise<string[]> {
    let folders: string[];
    try {
      folders = await readdir(root);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return [];
      throw error;
    }
    const files: string[] = [];
    for (const folder of folders) {
      // omo nests sessions under a cwd folder; a session file passed to `--session` may also sit at the top.
      if (folder.endsWith(".jsonl")) {
        files.push(path.join(root, folder));
        continue;
      }
      const directory = path.join(root, folder);
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
      entry = { size: 0, mtimeMs: 0, scanned: 0, tail: "", record: null, entryIds: new Set() };
    }
    const text = entry.tail + await readRange(file, entry.scanned, info.size);
    const lastNewline = text.lastIndexOf("\n");
    const complete = lastNewline === -1 ? "" : text.slice(0, lastNewline);
    let record = entry.record === null ? null
      : { ...entry.record, facts: { ...entry.record.facts, defects: [...entry.record.facts.defects] } };
    const { entryIds } = entry;
    for (const line of complete.split("\n")) record = applyLine(record, line, file, entryIds);
    const tail = lastNewline === -1 ? text : text.slice(lastNewline + 1);
    if (record !== null) {
      record.updatedAtMs = info.mtimeMs;
      record.facts.sizeBytes = info.size;
      if (this.isExternal(record)) record.source = "alpha";
    }
    this.cache.set(file, { size: info.size, mtimeMs: info.mtimeMs, scanned: info.size, tail, record, entryIds });
    return record;
  }
}
