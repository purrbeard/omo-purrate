import os from "node:os";
import path from "node:path";
import type { ImportCandidate, ImportEvidence, ImportLocation, ImportPage } from "../../shared/ipc";
import type { SessionIndex, SessionRecord } from "../omo/native/threads";
import { newestFirst } from "../omo/native/threads";

/** First messages that machine drivers write; a session opened with one was not typed by a person. */
const MACHINE_FIRST_MESSAGES: readonly RegExp[] = [
  /^You are '[^']+', a member of team '/u,
  /^\{"owner_message":/u,
  /^Set the requested goal and work until/u,
  /^DORI_PROBE\b/u,
  /^DORI_REQUEST:/u,
  /^internal event, not an owner request/u,
];
const SIDE_CHAT_FIRST_MESSAGE = /^\[OmO UI side chat background\]/u;
const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;

interface Places {
  homeDir: string;
  tmpDir: string;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function location(cwd: string, places: Places): ImportLocation | null {
  if (cwd === "") return null;
  if (inside(places.tmpDir, cwd)) return "temp";
  if (cwd.split(/[\\/]/u).includes("_quarantine")) return "quarantine";
  if (inside(places.homeDir, cwd)) {
    const first = path.relative(places.homeDir, cwd).split(/[\\/]/u)[0] ?? "";
    if (first.startsWith(".")) return "hidden";
  }
  return null;
}

function evidence(record: SessionRecord): ImportEvidence {
  if (record.facts.userMessages === 0) return "empty";
  const first = (record.preview ?? "").trimStart();
  if (record.parentSession !== null || SIDE_CHAT_FIRST_MESSAGE.test(first)) return "child";
  const recorded = record.facts.evidence;
  if (record.source === "alpha" && (recorded === "other-client" || recorded === null)) return "alpha";
  if (recorded === "terminal" && MACHINE_FIRST_MESSAGES.some((pattern) => pattern.test(first))) return "automation";
  return recorded ?? "terminal";
}

export function toCandidate(record: SessionRecord, places: Places): ImportCandidate {
  const kind = evidence(record);
  const where = location(record.cwd, places);
  const importable = kind !== "empty" && record.facts.defects.length === 0;
  return {
    id: record.id,
    sessionPath: record.sessionPath,
    cwd: record.cwd,
    name: record.name,
    preview: record.preview,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
    sizeBytes: record.facts.sizeBytes,
    userMessages: record.facts.userMessages,
    evidence: kind,
    defects: [...record.facts.defects],
    location: where,
    importable,
    recommended: importable && where === null && (kind === "app" || kind === "alpha" || kind === "terminal"),
  };
}

/**
 * Sessions a person started in a terminal after `sinceMs` (when setup's import finished) that the sidebar lists without
 * another import. `known` holds every id the app already manages or once added, so a session removed from the sidebar
 * stays removed.
 */
export function sessionsToAdopt(candidates: readonly ImportCandidate[], known: ReadonlySet<string>, sinceMs: number): ImportCandidate[] {
  return candidates.filter((candidate) => candidate.recommended && candidate.evidence === "terminal" && candidate.createdAtMs >= sinceMs && !known.has(candidate.id));
}

interface Cursor {
  startedAtMs: number;
  updatedAtMs: number;
  sessionPath: string;
}

export function encodeCursor(cursor: Cursor): string {
  return `v1:${cursor.startedAtMs}:${cursor.updatedAtMs}:${Buffer.from(cursor.sessionPath, "utf8").toString("base64url")}`;
}

export function decodeCursor(value: unknown): Cursor | null {
  if (typeof value !== "string") return null;
  const match = /^v1:(\d+):(\d+(?:\.\d+)?):([A-Za-z0-9_-]*)$/u.exec(value);
  if (match === null) return null;
  return { startedAtMs: Number(match[1]), updatedAtMs: Number(match[2]), sessionPath: Buffer.from(match[3]!, "base64url").toString("utf8") };
}

/**
 * One page of a newest-first list. Later pages also repeat every record changed since paging started: such a record
 * moved above the cursor, and without the repeat a reader that already passed its new position would never see it.
 */
export function keysetPage<T extends SessionRecord>(records: readonly T[], cursorValue: unknown, limitValue: unknown, nowMs: number): { page: T[]; nextCursor: string | null } {
  const sorted = [...records].sort(newestFirst);
  const limit = typeof limitValue === "number" && Number.isInteger(limitValue) && limitValue > 0 ? Math.min(limitValue, MAX_PAGE) : DEFAULT_PAGE;
  const cursor = decodeCursor(cursorValue);
  const startedAtMs = cursor?.startedAtMs ?? nowMs;
  const after = cursor === null ? sorted : sorted.filter((record) => record.updatedAtMs < cursor.updatedAtMs
    || (record.updatedAtMs === cursor.updatedAtMs && record.sessionPath > cursor.sessionPath));
  const page = after.slice(0, limit);
  const moved = cursor === null ? [] : sorted.filter((record) => record.updatedAtMs > startedAtMs && !page.includes(record));
  const last = page.at(-1);
  const nextCursor = last === undefined || after.length <= limit ? null : encodeCursor({ startedAtMs, updatedAtMs: last.updatedAtMs, sessionPath: last.sessionPath });
  return { page: [...moved, ...page], nextCursor };
}

export async function importPage(index: SessionIndex, cursor: unknown, limit: unknown, places: Places = { homeDir: os.homedir(), tmpDir: os.tmpdir() }, nowMs = Date.now()): Promise<ImportPage> {
  const records = await index.list();
  const candidates = records.map((record) => toCandidate(record, places));
  const byPath = new Map(candidates.map((candidate) => [candidate.sessionPath, candidate]));
  const listed = records.filter((record) => byPath.get(record.sessionPath)?.evidence !== "empty");
  const { page, nextCursor } = keysetPage(listed, cursor, limit, nowMs);
  return {
    items: page.map((record) => byPath.get(record.sessionPath)!),
    nextCursor,
    emptyCount: candidates.length - listed.length,
  };
}
