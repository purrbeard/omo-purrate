import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { BranchResult } from "../../shared/ipc";
import { sessionFolder, uuidv7 } from "../omo/native/threads";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate the documented CLI format, not the separate version-4 harness journal. */
function session(text: string): { header: Record<string, unknown>; cwd: string; tail: string } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const header: unknown = JSON.parse(lines.shift() ?? "");
  if (!record(header) || header["type"] !== "session" || typeof header["id"] !== "string" || header["id"].trim() === ""
    || typeof header["version"] !== "number" || ![1, 2, 3].includes(header["version"])
    || typeof header["cwd"] !== "string" || !path.isAbsolute(header["cwd"])
    || typeof header["timestamp"] !== "string" || !Number.isFinite(Date.parse(header["timestamp"]))) {
    throw new Error("Invalid or unsupported native CLI session header (versions 1-3 required)");
  }
  const ids = new Set<string>();
  for (const line of lines) {
    if (line.trim() === "") continue;
    const entry: unknown = JSON.parse(line);
    if (!record(entry) || typeof entry["type"] !== "string" || entry["type"] === "session") throw new Error("Invalid session entry");
    if (header["version"] === 1) continue;
    const id = entry["id"];
    const parent = entry["parentId"];
    if (typeof id !== "string" || id === "" || ids.has(id)) throw new Error("Missing or duplicate session entry id");
    if (parent !== null && (typeof parent !== "string" || !ids.has(parent))) throw new Error("Session entry has an unknown parent");
    ids.add(id);
  }
  const newline = text.indexOf("\n");
  return { header, cwd: header["cwd"], tail: newline === -1 ? "" : text.slice(newline + 1) };
}

export async function exportSessionJsonl(source: string, target: string): Promise<{ path: string }> {
  const bytes = await readFile(source);
  session(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  return { path: target };
}

/** Import is a new copy; modern entry bytes stay intact and only legacy linear copies are migrated. */
export async function importSessionJsonl(source: string, sessionsDir: string): Promise<BranchResult> {
  const parsed = session(new TextDecoder("utf-8", { fatal: true }).decode(await readFile(source)));
  const threadId = uuidv7();
  const timestamp = new Date().toISOString();
  const header: Record<string, unknown> = { ...parsed.header, id: threadId, timestamp, parentSession: source };
  let tail = parsed.tail;
  if (parsed.header["version"] === 1) {
    // Legacy linear entries have no tree identity; migrate the new copy so the local history reader can consume it.
    let parentId: string | null = null;
    tail = tail.split(/\r?\n/).filter(line => line.trim() !== "").map(line => {
      const entry: unknown = JSON.parse(line);
      if (!record(entry)) throw new Error("Invalid legacy entry");
      const id = randomUUID();
      const next = JSON.stringify({ ...entry, id, parentId });
      parentId = id;
      return next;
    }).join("\n");
    if (tail) tail += "\n";
    header["version"] = 2;
  }
  const directory = path.join(sessionsDir, sessionFolder(parsed.cwd));
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, `${timestamp.replace(/[:.]/g, "-")}_${threadId}.jsonl`);
  await writeFile(target, `${JSON.stringify(header)}\n${tail}`, { flag: "wx", mode: 0o600 });
  return { path: target, threadId };
}
