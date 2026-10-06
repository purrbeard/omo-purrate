import { languageForPath } from "@deepseek-ai/dsh-client-ui-primitives";
import type {
  CommandExecutionItem,
  DynamicToolCallContentItem,
  DynamicToolCallItem,
  FileChangeItem,
  McpToolCallItem,
  WebSearchItem,
} from "../../../shared/protocol";
import type { MessageKey } from "../../i18n";
import { fileChangeTotals } from "./diff";
import { displayPath, firstLine, isRecord } from "./format";

export type ToolItem = DynamicToolCallItem | CommandExecutionItem | FileChangeItem | McpToolCallItem | WebSearchItem;

export type ToolKind =
  | "code"
  | "edit"
  | "write"
  | "read"
  | "task"
  | "todo"
  | "question"
  | "web"
  | "fetch"
  | "search"
  | "command"
  | "fileChange"
  | "mcp"
  | "generic";

/** Row presentation state; "stopped" is a call still marked inProgress after its turn stopped streaming. */
export type ToolState = "running" | "ok" | "error" | "stopped";

export type ToolStatus = "inProgress" | "completed" | "failed";

export interface ToolRowModel {
  /** data-tool: the dynamic or MCP tool name, otherwise the item type. */
  tool: string;
  kind: ToolKind;
  titleKey: MessageKey | null;
  /** Verbatim title used when titleKey is null. */
  title: string;
  summary: string;
  totals: { added: number; removed: number } | null;
  state: ToolState;
  status: ToolStatus;
  durationMs: number | null;
  expandable: boolean;
}

interface KnownTool {
  kind: ToolKind;
  titleKey: MessageKey;
}

const KNOWN_TOOLS = new Map<string, KnownTool>([
  ["eval", { kind: "code", titleKey: "conversation.tool.title.eval" }],
  ["edit", { kind: "edit", titleKey: "conversation.tool.title.edit" }],
  ["write", { kind: "write", titleKey: "conversation.tool.title.write" }],
  ["read", { kind: "read", titleKey: "conversation.tool.title.read" }],
  ["task", { kind: "task", titleKey: "conversation.tool.title.task" }],
  ["todo", { kind: "todo", titleKey: "conversation.tool.title.todo" }],
  ["todo_write", { kind: "todo", titleKey: "conversation.tool.title.todo" }],
  ["ask_user_question", { kind: "question", titleKey: "conversation.tool.title.question" }],
  ["web_search", { kind: "web", titleKey: "conversation.tool.title.webSearch" }],
  ["websearch", { kind: "web", titleKey: "conversation.tool.title.webSearch" }],
  ["webfetch", { kind: "fetch", titleKey: "conversation.tool.title.webFetch" }],
  ["web_fetch", { kind: "fetch", titleKey: "conversation.tool.title.webFetch" }],
  ["grep", { kind: "search", titleKey: "conversation.tool.title.search" }],
  ["glob", { kind: "search", titleKey: "conversation.tool.title.search" }],
]);

const STATUS_OF: Record<ToolState, ToolStatus> = {
  running: "inProgress",
  ok: "completed",
  error: "failed",
  stopped: "failed",
};

function settledState(wireStatus: string, streaming: boolean, failed: boolean): ToolState {
  if (wireStatus === "inProgress") return streaming ? "running" : "stopped";
  return wireStatus === "failed" || wireStatus === "declined" || failed ? "error" : "ok";
}

function stringArg(args: Record<string, unknown> | null, keys: readonly string[]): string {
  if (args === null) return "";
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim() !== "") return firstLine(value);
  }
  return "";
}

function previewValue(value: unknown): string {
  if (typeof value === "string") return firstLine(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  return isRecord(value) ? "{…}" : "";
}

export function argumentPreview(args: unknown): string {
  if (typeof args === "string") return firstLine(args);
  if (Array.isArray(args)) return `[${args.length}]`;
  if (!isRecord(args)) return "";
  return Object.entries(args)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${previewValue(value)}`)
    .join(", ");
}

function hasContent(value: unknown): boolean {
  if (typeof value === "string") return value !== "";
  if (Array.isArray(value)) return value.length > 0;
  return isRecord(value) && Object.keys(value).length > 0;
}

function firstQuestion(args: Record<string, unknown> | null): string {
  const questions = args?.["questions"];
  const first: unknown = Array.isArray(questions) ? questions[0] : undefined;
  return isRecord(first) ? stringArg(first, ["question", "header"]) : "";
}

function dynamicSummary(kind: ToolKind, args: Record<string, unknown> | null, cwd: string | null): string {
  switch (kind) {
    case "code":
      return stringArg(args, ["summary", "description", "code"]);
    case "edit":
    case "write":
    case "read": {
      const path = stringArg(args, ["path", "file_path", "filePath"]);
      return path === "" ? "" : displayPath(path, cwd);
    }
    case "task":
      return stringArg(args, ["description", "summary", "prompt"]);
    case "web":
    case "fetch":
      return stringArg(args, ["query", "url"]);
    case "search":
      return stringArg(args, ["pattern", "query", "path"]);
    case "question":
      return firstQuestion(args);
    default:
      return "";
  }
}

/** Parses eval-style output, a JSON object with a string `text` and an optional `hasError` flag. */
export function structuredOutput(raw: string): { text: string; error: boolean } | null {
  if (!raw.trimStart().startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isRecord(parsed) && typeof parsed["text"] === "string"
    ? { text: parsed["text"], error: parsed["hasError"] === true }
    : null;
}

function reportsError(items: DynamicToolCallContentItem[] | null): boolean {
  return (items ?? []).some((item) => item.type === "inputText" && structuredOutput(item.text)?.error === true);
}

export function toolRowModel(item: ToolItem, streaming: boolean, elapsed: number | null, cwd: string | null): ToolRowModel {
  switch (item.type) {
    case "dynamicToolCall": {
      const known = KNOWN_TOOLS.get(item.tool);
      const kind = known?.kind ?? "generic";
      const args = isRecord(item.arguments) ? item.arguments : null;
      const state = settledState(item.status, streaming, item.success === false || reportsError(item.contentItems));
      return {
        tool: item.tool,
        kind,
        titleKey: known?.titleKey ?? null,
        title: item.tool,
        summary: dynamicSummary(kind, args, cwd) || argumentPreview(item.arguments),
        totals: null,
        state,
        status: STATUS_OF[state],
        durationMs: item.durationMs ?? elapsed,
        expandable: hasContent(item.arguments) || (item.contentItems?.length ?? 0) > 0,
      };
    }
    case "commandExecution": {
      const state = settledState(item.status, streaming, typeof item.exitCode === "number" && item.exitCode !== 0);
      return {
        tool: item.type,
        kind: "command",
        titleKey: "conversation.tool.title.command",
        title: item.type,
        summary: firstLine(item.command),
        totals: null,
        state,
        status: STATUS_OF[state],
        durationMs: item.durationMs ?? elapsed,
        expandable: true,
      };
    }
    case "fileChange": {
      const state = settledState(item.status, streaming, false);
      return {
        tool: item.type,
        kind: "fileChange",
        titleKey: "conversation.tool.title.fileChange",
        title: item.type,
        summary: item.changes.map((change) => displayPath(change.path, cwd)).join(", "),
        totals: item.changes.length > 0 ? fileChangeTotals(item.changes) : null,
        state,
        status: STATUS_OF[state],
        durationMs: elapsed,
        expandable: item.changes.length > 0,
      };
    }
    case "mcpToolCall": {
      const state = settledState(item.status, streaming, item.error !== null && item.error !== undefined);
      return {
        tool: item.tool,
        kind: "mcp",
        titleKey: null,
        title: item.tool,
        summary: [item.server, argumentPreview(item.arguments)].filter((part) => part !== "").join(" · "),
        totals: null,
        state,
        status: STATUS_OF[state],
        durationMs: item.durationMs ?? elapsed,
        expandable: hasContent(item.arguments) || (item.result !== null && item.result !== undefined) || Boolean(item.error),
      };
    }
    case "webSearch": {
      const state: ToolState = streaming ? "running" : "ok";
      return {
        tool: item.type,
        kind: "web",
        titleKey: "conversation.tool.title.webSearch",
        title: item.type,
        summary: firstLine(item.query),
        totals: null,
        state,
        status: STATUS_OF[state],
        durationMs: elapsed,
        expandable: false,
      };
    }
  }
}

export interface ToolInputModel {
  code: { text: string; language: string | undefined } | null;
  json: Record<string, unknown> | unknown[] | null;
  text: string | null;
}

function omit(args: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> | null {
  const rest = Object.fromEntries(Object.entries(args).filter(([key]) => !keys.includes(key)));
  return Object.keys(rest).length > 0 ? rest : null;
}

/** Splits tool arguments into a code argument (CodeBlock) and the remaining values (JsonTree). */
export function toolInput(tool: string, args: unknown): ToolInputModel {
  if (typeof args === "string") return { code: null, json: null, text: args === "" ? null : args };
  if (Array.isArray(args)) return { code: null, json: args.length > 0 ? args : null, text: null };
  if (!isRecord(args)) return { code: null, json: null, text: null };
  const code = args["code"];
  if (typeof code === "string" && code !== "") {
    const language = stringArg(args, ["language", "lang"]);
    return {
      code: { text: code, language: language === "" ? undefined : language },
      json: omit(args, ["code", "language", "lang", "summary"]),
      text: null,
    };
  }
  const content = args["content"];
  if (tool === "write" && typeof content === "string" && content !== "") {
    const path = stringArg(args, ["path", "file_path", "filePath"]);
    return { code: { text: content, language: languageForPath(path) }, json: omit(args, ["content"]), text: null };
  }
  return { code: null, json: Object.keys(args).length > 0 ? args : null, text: null };
}

export type ToolOutputPart =
  | { kind: "terminal"; text: string; error: boolean }
  | { kind: "text"; text: string }
  | { kind: "image"; url: string };

export function toolOutputs(items: DynamicToolCallContentItem[] | null): ToolOutputPart[] {
  return (items ?? []).flatMap((item): ToolOutputPart[] => {
    if (item.type === "inputImage") return [{ kind: "image", url: item.imageUrl }];
    if (item.type !== "inputText") return [];
    const structured = structuredOutput(item.text);
    return [structured === null ? { kind: "text", text: item.text } : { kind: "terminal", ...structured }];
  });
}
