import { visit, type JSONPath } from "jsonc-parser/lib/esm/main.js";

const ROOT = new Set(["id", "parentId", "type", "timestamp", "provider", "modelId", "thinkingLevel", "customType", "display", "tokensBefore", "summary", "targetId", "label", "content"]);
const MESSAGE = new Set(["role", "stopReason", "errorMessage", "toolCallId", "toolName", "isError", "provider", "model"]);
const BLOCK = new Set(["type", "text", "thinking", "id", "name", "mimeType", "data"]);
function container(value: unknown): value is Record<string | number, unknown> { return typeof value === "object" && value !== null; }

/** Scan historical payloads without JSON.parse constructing tool outputs, images or runtime metadata. */
export function sessionOutline(source: string): string {
  if (source.trim() === "") return "";
  const result: Record<string, unknown> = {};
  let invalid = false;
  const selected = (path: JSONPath): boolean => {
    if (path.length === 1) return ROOT.has(String(path[0]));
    if (path[0] === "message") {
      if (path.length === 2) return MESSAGE.has(String(path[1])) || path[1] === "content";
      if (path[1] === "content") return path.length === 4 && BLOCK.has(String(path[3]));
      if (path[1] === "usage") return path.length === 3;
      if (path.length === 2 && (path[1] === "provider" || path[1] === "model")) return true;
      if (path[1] === "details") return ["task_id", "status", "mode", "execution_mode", "task_summary", "name", "category", "subagent_type", "agent_type", "model", "resolved_model", "final_response", "error_message", "writeNotice"].includes(String(path[2]));
    }
    // Todo and completion metadata are small structured state, independent of transcript pages.
    return path[0] === "data" || path[0] === "details" || path[0] === "content";
  };
  const assign = (path: JSONPath, value: unknown): void => {
    let target: Record<string | number, unknown> = result;
    for (let index = 0; index < path.length - 1; index += 1) {
      const key = path[index];
      if (key === undefined || key === "__proto__" || key === "constructor" || key === "prototype") return;
      const next = target[key];
      if (typeof next !== "object" || next === null) target[key] = typeof path[index + 1] === "number" ? [] : {};
      const child = target[key];
      if (!container(child)) return;
      target = child;
    }
    const key = path.at(-1);
    if (key !== undefined && key !== "__proto__" && key !== "constructor" && key !== "prototype") target[key] = value;
  };
  visit(source, {
    onLiteralValue(value: unknown, _offset, _length, _line, _column, supply) {
      const path = supply();
      if (!selected(path)) return;
      assign(path, value);
    },
    onError() { invalid = true; },
  }, { disallowComments: true });
  if (result["customType"] !== "senpi.todo-state") delete result["data"];
  if (result["customType"] !== "omo-senpi:wake") delete result["details"];
  const message = result["message"];
  if (typeof message === "object" && message !== null && "role" in message && message.role !== "user" && "content" in message) {
    const preview = (value: unknown): unknown => {
      if (typeof value === "string") return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
      if (Array.isArray(value)) return value.map(preview);
      if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "data").map(([key, field]) => [key, preview(field)]));
      return value;
    };
    message.content = preview(message.content);
  }
  return invalid ? "" : JSON.stringify(result);
}
