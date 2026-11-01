import { createReadStream } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { CodexSessionList, CodexSessionSummary } from "../../shared/codex-import";

/** Codex keeps its state under CODEX_HOME, defaulting to ~/.codex. */
export function codexHomeDir(env: NodeJS.ProcessEnv, homeDir: string): string {
  const configured = env["CODEX_HOME"]?.trim();
  return configured ? path.resolve(configured) : path.join(homeDir, ".codex");
}

const ROLLOUT = /^rollout-.*\.jsonl$/;
/** Only this much of a rollout is read for its listing; the session_meta line carries instructions and can be large. */
export const HEAD_BYTES = 1 << 20;
const MAX_LISTED = 500;
const TITLE_CHARS = 80;
const INJECTED = /^\s*(<[a-z_]+[\s>]|# AGENTS\.md)/i;

const record = (value: unknown): Record<string, unknown> | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() !== "" ? value : null;

/** Codex writes Windows cwds with the extended-length prefix (\\?\P:\...). */
export function plainCwd(cwd: string): string {
  if (cwd.startsWith("\\\\?\\UNC\\")) return `\\\\${cwd.slice(8)}`;
  return cwd.startsWith("\\\\?\\") ? cwd.slice(4) : cwd;
}

export function summarizePrompt(prompt: string): string | null {
  const line = prompt.split(/\r?\n/).map(part => part.trim()).find(part => part !== "");
  if (line === undefined) return null;
  const flat = line.replace(/\s+/g, " ");
  return flat.length > TITLE_CHARS ? `${flat.slice(0, TITLE_CHARS - 1)}…` : flat;
}

function userText(payload: Record<string, unknown>): string | null {
  if (payload["type"] === "user_message") return text(payload["message"]);
  if (payload["type"] !== "message" || payload["role"] !== "user" || !Array.isArray(payload["content"])) return null;
  const joined = payload["content"].map(block => text(record(block)?.["text"]) ?? "").join("\n");
  return text(joined) !== null && !INJECTED.test(joined) ? joined : null;
}

export async function readRolloutHead(file: string, limit = HEAD_BYTES): Promise<{ id: string | null; cwd: string | null; startedAt: string | null; prompt: string | null }> {
  const handle = await open(file, "r");
  const buffer = Buffer.alloc(limit);
  let read = 0;
  try {
    while (read < limit) {
      const { bytesRead } = await handle.read(buffer, read, limit - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
  } finally { await handle.close(); }
  const head = buffer.subarray(0, read).toString("utf8");
  const end = read < limit ? head.length : head.lastIndexOf("\n");
  let id: string | null = null, cwd: string | null = null, startedAt: string | null = null, fallback: string | null = null;
  for (const line of head.slice(0, Math.max(end, 0)).split("\n")) {
    let entry: Record<string, unknown> | null;
    try { entry = record(JSON.parse(line.replace(/^\uFEFF/, ""))); } catch { continue; }
    const payload = record(entry?.["payload"]);
    if (entry === null || payload === null) continue;
    if (entry["type"] === "session_meta" && id === null) {
      id = text(payload["id"]) ?? text(payload["session_id"]);
      const where = text(payload["cwd"]);
      cwd = where === null ? null : plainCwd(where);
      startedAt = text(payload["timestamp"]) ?? text(entry["timestamp"]);
      continue;
    }
    if (entry["type"] === "event_msg" && payload["type"] === "user_message") {
      const prompt = userText(payload);
      if (prompt !== null) return { id, cwd, startedAt, prompt };
    }
    if (entry["type"] === "response_item" && fallback === null) fallback = userText(payload);
  }
  return { id, cwd, startedAt, prompt: fallback };
}

/** session_index.jsonl maps thread ids to the names Codex shows; the newest line for an id wins. */
async function threadNames(home: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const input = createReadStream(path.join(home, "session_index.jsonl"));
  try {
    for await (const line of createInterface({ input, crlfDelay: Infinity })) {
      let entry: Record<string, unknown> | null;
      try { entry = record(JSON.parse(line)); } catch { continue; }
      const id = text(entry?.["id"]), name = text(entry?.["thread_name"]);
      if (id !== null && name !== null) names.set(id, name.trim());
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  } finally { input.destroy(); }
  return names;
}

async function rollouts(directory: string, found: string[]): Promise<void> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await rollouts(file, found);
    else if (entry.isFile() && ROLLOUT.test(entry.name)) found.push(file);
  }
}

/** Source ids already copied: each import's second record is custom codex-import with data.sourceId. */
export async function importedCodexIds(sessionsDir: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let folders;
  try { folders = await readdir(sessionsDir, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ids; throw error; }
  for (const folder of folders) {
    if (!folder.isDirectory() || !folder.name.includes("-codex-")) continue;
    const directory = path.join(sessionsDir, folder.name);
    for (const file of await readdir(directory)) {
      if (!file.endsWith(".jsonl")) continue;
      const input = createReadStream(path.join(directory, file), { end: (1 << 16) - 1 });
      let number = 0;
      try {
        for await (const line of createInterface({ input, crlfDelay: Infinity })) {
          if (++number > 2) break;
          let entry: Record<string, unknown> | null;
          try { entry = record(JSON.parse(line)); } catch { break; }
          const id = entry?.["customType"] === "codex-import" ? text(record(entry["data"])?.["sourceId"]) : null;
          if (id !== null) ids.add(id);
        }
      } finally { input.destroy(); }
    }
  }
  return ids;
}

export async function listCodexSessions(home: string, sessionsDir: string): Promise<CodexSessionList> {
  const files: string[] = [];
  await rollouts(path.join(home, "sessions"), files);
  await rollouts(path.join(home, "archived_sessions"), files);
  const stamped = await Promise.all(files.map(async file => ({ file, info: await stat(file) })));
  stamped.sort((left, right) => right.info.mtimeMs - left.info.mtimeMs);
  const [names, imported] = await Promise.all([threadNames(home), importedCodexIds(sessionsDir)]);
  const items: CodexSessionSummary[] = [];
  for (const { file, info } of stamped.slice(0, MAX_LISTED)) {
    const head = await readRolloutHead(file);
    const named = head.id === null ? undefined : names.get(head.id);
    const prompt = head.prompt === null ? null : summarizePrompt(head.prompt);
    items.push({
      sourcePath: file, sourceId: head.id, cwd: head.cwd,
      project: head.cwd === null ? null : path.win32.basename(head.cwd.replace(/[\\/]+$/, "")) || head.cwd,
      title: named ?? prompt, titleSource: named !== undefined ? "codex" : prompt !== null ? "prompt" : "date",
      startedAt: head.startedAt, updatedAtMs: info.mtimeMs, bytes: info.size,
      imported: head.id !== null && imported.has(head.id),
    });
  }
  return { root: home, items, omitted: Math.max(0, stamped.length - MAX_LISTED) };
}

/** Preview requests from the list are accepted only for real rollout files inside the discovered folders. */
export async function discoveredRollout(home: string, file: string): Promise<string> {
  if (!path.isAbsolute(file) || !ROLLOUT.test(path.basename(file))) throw new TypeError("Not a Codex rollout");
  const resolved = await realpath(file);
  for (const folder of ["sessions", "archived_sessions"]) {
    let root: string;
    try { root = await realpath(path.join(home, folder)); } catch { continue; }
    const relative = path.relative(root, resolved);
    if (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) return resolved;
  }
  throw new Error("Codex rollout is outside the Codex sessions folders");
}
