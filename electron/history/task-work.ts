import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { TaskWork, ThreadLink } from "../../shared/ipc";
import { object, parseTasksUpdated } from "../../src/state/live-wire";
import { parseSessionJsonl } from "./session-jsonl";

const ID = /^[A-Za-z0-9_-]{1,256}$/u;
const TASK_FIELDS = [
  "task_id", "status", "execution_mode", "model", "residency_state", "depth", "created_at", "updated_at",
  "name", "task_summary", "description", "category", "agent_type", "child_session_id", "run_stats", "final_response", "error_message",
] as const;

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

async function hasLegacyRecords(directory: string): Promise<boolean> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.includes(".") || await hasLegacyRecords(path.join(directory, entry.name))) return true;
  }
  return false;
}

/** Matches native store adoption: empty scaffolds do not mask the agent store; records and .in-project do. */
export async function taskStore(agentDir: string, cwd: string): Promise<string> {
  const project = await realpath(cwd);
  const legacy = path.join(project, ".omo", "senpi-task");
  try {
    if (!(await lstat(legacy)).isDirectory() || await hasLegacyRecords(legacy)) return legacy;
  } catch (error) {
    if (!missing(error)) throw error;
  }
  const hash = createHash("sha256").update(project).digest("hex").slice(0, 12);
  const name = path.basename(project).replace(/[^\p{L}\p{N}._-]/gu, "_") || "root";
  return path.join(agentDir, "projects", `${name}-${hash}`, "senpi-task");
}

async function contained(root: string, file: string, alternateRoot?: string): Promise<string> {
  const target = await realpath(file);
  for (const candidate of alternateRoot === undefined ? [root] : [root, alternateRoot]) {
    let resolved;
    try {
      resolved = await realpath(candidate);
    } catch (error) {
      if (missing(error)) continue;
      throw error;
    }
    const relative = path.relative(resolved, target);
    if (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) return target;
  }
  throw new Error("Child work path is outside its native store");
}

async function sessionFile(directory: string, sessionId: string): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.endsWith(`_${sessionId}.jsonl`)) return file;
    if (entry.isDirectory()) {
      const found = await sessionFile(file, sessionId);
      if (found !== null) return found;
    }
  }
  return null;
}

async function taskRecords(store: string): Promise<Record<string, unknown>[]> {
  let entries;
  try {
    entries = await readdir(path.join(store, "tasks"), { withFileTypes: true });
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
  const records: Record<string, unknown>[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(await contained(store, path.join(store, "tasks", entry.name)), "utf8"));
    } catch (error) {
      if (missing(error) || error instanceof SyntaxError) continue; // A live writer can replace or incompletely write a record.
      throw error;
    }
    if (object(raw)) records.push(raw);
  }
  return records;
}

/** Workspace ownership only: does not read child sessions or their todos. */
export async function readTaskLinks(options: { cwd: string; agentDir?: string }): Promise<ThreadLink[]> {
  if (!path.isAbsolute(options.cwd)) throw new Error("Invalid child work workspace");
  const store = await taskStore(options.agentDir ?? path.join(homedir(), ".omo", "agent"), options.cwd);
  const links: ThreadLink[] = [];
  for (const raw of await taskRecords(store)) {
    const parentId = raw["parent_session_id"];
    const taskId = raw["task_id"];
    const childId = raw["child_session_id"];
    if (typeof parentId !== "string" || !ID.test(parentId) || typeof taskId !== "string" || !ID.test(taskId) ||
      (childId !== undefined && (typeof childId !== "string" || !ID.test(childId)))) continue;
    const title = [raw["task_summary"], raw["name"]].find((value) => typeof value === "string" && value.trim().length > 0);
    links.push({ parentId, taskId, ...(typeof childId === "string" ? { childId } : {}),
      title: typeof title === "string" ? title.trim() : taskId,
      ...(typeof raw["status"] === "string" ? { status: raw["status"] } : {}) });
  }
  return links;
}

/** Native task snapshots omit todos: read the child's active JSONL branch, without resuming or launching it. */
export async function loadTaskWork(agentDir: string, cwd: string, parentSessionId: string): Promise<TaskWork[]> {
  if (!path.isAbsolute(cwd) || !ID.test(parentSessionId)) throw new Error("Invalid child work workspace or session id");
  const store = await taskStore(agentDir, cwd);
  const records = new Map<string, { raw: Record<string, unknown>; work: TaskWork }>();
  for (const raw of await taskRecords(store)) {
    if (typeof raw["parent_session_id"] !== "string") continue;
    const projected = Object.fromEntries(TASK_FIELDS.filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
    const task = parseTasksUpdated({ parent_session_id: raw["parent_session_id"], tasks: [projected] })?.tasks[0];
    if (task === undefined || !ID.test(task.task_id) || (task.child_session_id !== undefined && !ID.test(task.child_session_id))) continue;
    records.set(task.task_id, { raw, work: { parentSessionId: raw["parent_session_id"], task, todo: null, activity: null } });
  }
  const sessions = new Set([parentSessionId]);
  const selected = new Map<string, TaskWork>();
  let added = true;
  while (added) {
    added = false;
    for (const { work } of records.values()) {
      if (selected.has(work.task.task_id) || !sessions.has(work.parentSessionId)) continue;
      selected.set(work.task.task_id, work);
      if (work.task.child_session_id !== undefined) sessions.add(work.task.child_session_id);
      added = true;
    }
  }
  await Promise.all([...selected.values()].map(async (work) => {
    const { task } = work;
    if (task.child_session_id === undefined) return;
    const raw = records.get(task.task_id)?.raw;
    const host = raw?.["host_session"];
    const children = path.join(store, "children", task.task_id, "sessions");
    const hostPath = object(host) && typeof host["session_path"] === "string" ? host["session_path"] : null;
    const file = hostPath ?? await sessionFile(children, task.child_session_id);
    if (file === null) return;
    try {
      const target = await contained(children, file, hostPath === null ? undefined : path.join(agentDir, "sessions"));
      const text = await readFile(target, "utf8");
      const header: unknown = JSON.parse(text.split("\n")[0] ?? "");
      if (!object(header) || header["id"] !== task.child_session_id) return;
      const history = parseSessionJsonl(text);
      work.history = history;
      work.todo = history.todo;
      const items = history.turns.flatMap((turn) => turn.items);
      const latest = items.findLast((item) => item.type === "agentMessage" || item.type === "dynamicToolCall");
      work.activity = latest?.type === "agentMessage" ? latest.text.replace(/\s+/gu, " ").trim().slice(-240)
        : latest?.type === "dynamicToolCall" ? latest.tool : null;
    } catch (error) {
      if (missing(error) || error instanceof SyntaxError) return;
      throw error;
    }
  }));
  return [...selected.values()];
}
