import type { DagActivity, DagHeartbeat, DagNode, DagRun, DagUpdated, LiveTask, TasksUpdated, TaskRunStats, TodoPhase, WireGoal } from "../../shared/protocol";

type ObjectValue = Record<string, unknown>;
export function object(value: unknown): value is ObjectValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const string = (value: unknown): value is string => typeof value === "string";
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(string);
function fields(value: ObjectValue, required: string[], optional: string[], check: (field: unknown) => boolean): boolean {
  return required.every((key) => check(value[key])) && optional.every((key) => value[key] === undefined || check(value[key]));
}
function list<T>(value: unknown, check: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(check);
}
function oneOf(value: unknown, values: string[]): boolean {
  return string(value) && values.includes(value);
}
function node(value: unknown): value is DagNode {
  return object(value) && fields(value, ["id", "prompt", "state", "created_at"], ["label", "task_id", "started_at", "completed_at"], string) &&
    number(value["attempt"]) && strings(value["depends_on"]) &&
    (value["last_error"] === undefined || (object(value["last_error"]) && fields(value["last_error"], ["code", "message"], [], string)));
}
function run(value: unknown): value is DagRun {
  return object(value) && fields(value, ["run_id", "run_key", "name", "status", "created_at", "updated_at"], ["completed_at"], string) &&
    fields(value, [], ["amend_count", "lease_holder_pid"], number) &&
    object(value["counts"]) && Object.values(value["counts"]).every(number) && list(value["nodes"], node) &&
    list(value["edges"], (edge): edge is { from: string; to: string } => object(edge) && string(edge["from"]) && string(edge["to"])) &&
    list(value["waves"], (wave): wave is { index: number; node_ids: string[] } => object(wave) && number(wave["index"]) && strings(wave["node_ids"]));
}
export function parseDagUpdated(value: unknown): DagUpdated | null {
  if (!object(value) || !string(value["parent_session_id"]) || !list(value["runs"], run) ||
    !fields(value, [], ["truncated_runs"], number)) return null;
  return { parent_session_id: value["parent_session_id"], runs: value["runs"],
    ...(number(value["truncated_runs"]) ? { truncated_runs: value["truncated_runs"] } : {}) };
}
function stats(value: unknown): value is TaskRunStats {
  if (!object(value) || !fields(value, ["runtime_ms", "turns", "tool_calls"], [
    "output_tokens", "input_tokens", "cache_read_tokens", "cache_write_tokens", "total_tokens", "generation_ms",
    "tokens_per_second", "cost_usd", "cache_hit_rate_last", "cache_hit_rate_run",
  ], number)) return false;
  return (value["token_status"] === undefined || oneOf(value["token_status"], ["complete", "partial", "unavailable"])) &&
    (value["cost_status"] === undefined || oneOf(value["cost_status"], ["reported", "unavailable", "invalid"])) &&
    (value["duration_status"] === undefined || oneOf(value["duration_status"], ["monotonic", "wall_clock", "unavailable"]));
}
function task(value: unknown): value is LiveTask {
  if (!object(value) || !fields(value, ["task_id", "status", "execution_mode", "model", "residency_state", "created_at", "updated_at"],
    ["name", "task_summary", "description", "category", "agent_type", "child_session_id", "final_response", "error_message"], string) ||
    !number(value["depth"]) || !fields(value, [], ["description_truncated", "final_response_truncated", "error_message_truncated"], (flag) => flag === true) ||
    (value["run_stats"] !== undefined && !stats(value["run_stats"]))) return false;
  const progress = value["live_progress"];
  return progress === undefined || (object(progress) && fields(progress, ["activity"], ["current_tool", "last_assistant_line"], string) &&
    fields(progress, ["started_at", "turns"], ["tool_calls", "total_tokens", "output_tokens", "tokens_per_second"], number));
}
export function parseTasksUpdated(value: unknown): TasksUpdated | null {
  if (!object(value) || !string(value["parent_session_id"]) || !list(value["tasks"], task) || !fields(value, [], ["truncated_tasks"], number)) return null;
  return { parent_session_id: value["parent_session_id"], tasks: value["tasks"], ...(number(value["truncated_tasks"]) ? { truncated_tasks: value["truncated_tasks"] } : {}) };
}
function activity(value: unknown): value is DagActivity {
  return object(value) && value["schemaVersion"] === 1 &&
    fields(value, ["runId", "nodeId", "taskId", "at", "activity"], ["currentTool", "lastAssistantLine"], string) &&
    fields(value, ["turns"], ["toolCalls"], number);
}
export function parseDagActivity(value: unknown): DagActivity | null {
  return activity(value) ? value : null;
}
export function parseDagHeartbeat(value: unknown): DagHeartbeat | null {
  if (!object(value) || value["schemaVersion"] !== 1 || !string(value["at"]) ||
    !list(value["runs"], (entry): entry is { runId: string; headSeq: number } => object(entry) && string(entry["runId"]) && number(entry["headSeq"]))) return null;
  return { schemaVersion: 1, at: value["at"], runs: value["runs"] };
}
function goal(value: unknown): value is WireGoal {
  return object(value) && fields(value, ["threadId", "objective"], [], string) &&
    oneOf(value["status"], ["active", "paused", "blocked", "complete"]) &&
    (value["tokenBudget"] === null || number(value["tokenBudget"])) &&
    fields(value, ["tokensUsed", "timeUsedSeconds", "createdAt", "updatedAt"], [], number);
}
export function parseGoal(value: unknown): WireGoal | null {
  return goal(value) ? value : null;
}
export function parseTodo(value: unknown): { phases: TodoPhase[] } | null {
  if (!object(value) || value["schema"] !== "v2" || !Array.isArray(value["phases"])) return null;
  const phases: TodoPhase[] = [];
  for (const phase of value["phases"]) {
    if (!object(phase) || !string(phase["name"]) || !Array.isArray(phase["tasks"])) return null;
    const tasks: TodoPhase["tasks"] = [];
    for (const item of phase["tasks"]) {
      if (!object(item) || !string(item["content"])) return null;
      const status = item["status"] === "cancelled" ? "abandoned" : item["status"];
      if (status !== "pending" && status !== "in_progress" && status !== "completed" && status !== "abandoned") return null;
      tasks.push({ content: item["content"], status });
    }
    phases.push({ name: phase["name"], tasks });
  }
  return { phases };
}

export type LiveExtension =
  | { name: "omo.dag.updated"; data: DagUpdated }
  | { name: "omo.task.updated"; data: TasksUpdated }
  | { name: "omo.dag.activity"; data: DagActivity }
  | { name: "omo.dag.heartbeat"; data: DagHeartbeat };

export function parseLiveExtension(name: string, data: unknown): LiveExtension | null {
  switch (name) {
    case "omo.dag.updated": { const parsed = parseDagUpdated(data); return parsed === null ? null : { name, data: parsed }; }
    case "omo.task.updated": { const parsed = parseTasksUpdated(data); return parsed === null ? null : { name, data: parsed }; }
    case "omo.dag.activity": { const parsed = parseDagActivity(data); return parsed === null ? null : { name, data: parsed }; }
    case "omo.dag.heartbeat": { const parsed = parseDagHeartbeat(data); return parsed === null ? null : { name, data: parsed }; }
    default: return null;
  }
}
