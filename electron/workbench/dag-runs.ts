import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { DagNode, DagRun } from "../../shared/protocol";
import { taskStore } from "../history/task-work";
import { threadId, workspace } from "./validation";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function date(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function node(value: unknown): DagNode | null {
  if (!object(value) || typeof value["id"] !== "string" || typeof value["prompt"] !== "string" ||
    !strings(value["dependsOn"]) || typeof value["state"] !== "string" || typeof value["attempt"] !== "number" ||
    !Number.isSafeInteger(value["attempt"]) || value["attempt"] < 0 || !date(value["createdAt"])) return null;
  const result: DagNode = {
    id: value["id"], prompt: value["prompt"], depends_on: value["dependsOn"], state: value["state"], attempt: value["attempt"], created_at: value["createdAt"],
  };
  for (const [from, to] of [["label", "label"], ["taskId", "task_id"], ["startedAt", "started_at"], ["completedAt", "completed_at"]] as const) {
    const field = value[from];
    if (field === undefined) continue;
    if (typeof field !== "string" || ((from === "startedAt" || from === "completedAt") && !date(field))) return null;
    result[to] = field;
  }
  if (value["lastError"] !== undefined) {
    const error = value["lastError"];
    if (!object(error) || typeof error["code"] !== "string" || typeof error["message"] !== "string") return null;
    result.last_error = { code: error["code"], message: error["message"] };
  }
  return result;
}

function run(value: unknown, sessionId: string): DagRun | null {
  if (!object(value) || value["parentSessionId"] !== sessionId || typeof value["runId"] !== "string" ||
    typeof value["runKey"] !== "string" || typeof value["name"] !== "string" || typeof value["status"] !== "string" ||
    !date(value["createdAt"]) || !date(value["updatedAt"]) || !Array.isArray(value["nodes"]) ||
    !Array.isArray(value["edges"]) || !Array.isArray(value["waves"]) ||
    (value["completedAt"] !== undefined && !date(value["completedAt"]))) return null;
  const nodes: DagNode[] = [];
  const counts: Record<string, number> = {};
  for (const raw of value["nodes"]) {
    const parsed = node(raw);
    if (!parsed) return null;
    nodes.push(parsed);
    counts[parsed.state] = (Object.hasOwn(counts, parsed.state) ? counts[parsed.state]! : 0) + 1;
  }
  const edges: DagRun["edges"] = [];
  for (const edge of value["edges"]) {
    if (!object(edge) || typeof edge["from"] !== "string" || typeof edge["to"] !== "string") return null;
    edges.push({ from: edge["from"], to: edge["to"] });
  }
  const waves: DagRun["waves"] = [];
  for (const wave of value["waves"]) {
    if (!object(wave) || typeof wave["index"] !== "number" || !Number.isSafeInteger(wave["index"]) || wave["index"] < 0 || !strings(wave["nodeIds"])) return null;
    waves.push({ index: wave["index"], node_ids: wave["nodeIds"] });
  }
  return {
    run_id: value["runId"], run_key: value["runKey"], name: value["name"], status: value["status"],
    created_at: value["createdAt"], updated_at: value["updatedAt"],
    ...(typeof value["completedAt"] === "string" ? { completed_at: value["completedAt"] } : {}), counts, nodes, edges, waves,
  };
}

export async function loadPersistedDagRuns(agentDir: string, cwd: string, requestedThreadId: string): Promise<DagRun[]> {
  const sessionId = threadId(requestedThreadId);
  const store = await taskStore(agentDir, await workspace(cwd));
  let entries;
  try { entries = await readdir(path.join(store, "dag", "runs"), { withFileTypes: true }); }
  catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return [];
    throw error;
  }
  const root = await realpath(store);
  const runs: DagRun[] = [];
  for (const entry of entries) {
    if ((!entry.isFile() && !entry.isSymbolicLink()) || !entry.name.endsWith(".json")) continue;
    try {
      const file = await realpath(path.join(store, "dag", "runs", entry.name));
      const relative = path.relative(root, file);
      if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
      const parsed = run(JSON.parse(await readFile(file, "utf8")), sessionId);
      if (parsed) runs.push(parsed);
    } catch { continue; }
  }
  return runs.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 20);
}
