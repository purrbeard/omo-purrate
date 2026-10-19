import type { FileUpdateChange } from "../../../shared/protocol";

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: JsonObject, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function normalizedPatch(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  return value.endsWith("\n") ? value : `${value}\n`;
}

function changeKind(operation: unknown, movePath: unknown): unknown {
  if (operation === "add") return { type: "add" };
  if (operation === "delete") return { type: "delete" };
  if (operation === "update") return { type: "update", move_path: typeof movePath === "string" && movePath !== "" ? movePath : null };
  return undefined;
}

/** Tools whose result `details.patch` is a unified diff of the one file named by the call's path argument. */
const SINGLE_FILE_TOOLS = new Set(["edit", "write", "multiedit"]);

/**
 * The file changes an omo file tool recorded in its result details: apply_patch `preview.files[]`,
 * else the unified `details.patch` of edit/write/multiedit for the file its arguments name. Empty when none.
 */
export function toolFileChanges(name: string, args: unknown, details: unknown): FileUpdateChange[] {
  if (!isRecord(details)) return [];
  const preview = details["preview"];
  if (isRecord(preview) && Array.isArray(preview["files"])) {
    const changes = preview["files"].flatMap((file) => {
      if (!isRecord(file)) return [];
      const filePath = readString(file, "filePath");
      const kind = changeKind(file["operation"], file["movePath"]);
      const diff = normalizedPatch(file["patch"]);
      return filePath && kind && diff ? [{ path: filePath, kind, diff }] : [];
    });
    if (changes.length > 0) return changes;
  }
  const patch = normalizedPatch(details["patch"]);
  const filePath = isRecord(args) ? readString(args, "path") ?? readString(args, "file_path") ?? readString(args, "filePath") : undefined;
  if (!SINGLE_FILE_TOOLS.has(name) || !filePath || !patch) return [];
  const operation = details["operation"] === "add" || details["operation"] === "delete" || details["operation"] === "update"
    ? details["operation"] : patch.startsWith("--- /dev/null\n") ? "add" : "update";
  return [{ path: filePath, kind: changeKind(operation, null), diff: patch }];
}

function prefixed(text: string, mark: "+" | "-"): string {
  return text.replace(/\n$/, "").split("\n").map((line) => `${mark}${line}`).join("\n");
}

function editPairs(args: JsonObject): Array<{ before: string; after: string }> {
  const pair = (value: JsonObject): Array<{ before: string; after: string }> => {
    const before = readString(value, "oldText") ?? readString(value, "old_string") ?? readString(value, "oldString");
    const after = readString(value, "newText") ?? readString(value, "new_string") ?? readString(value, "newString");
    return before === undefined || after === undefined ? [] : [{ before, after }];
  };
  const edits = Array.isArray(args["edits"]) ? args["edits"].filter(isRecord).flatMap(pair) : [];
  return edits.length > 0 ? edits : pair(args);
}

/**
 * The files a file tool is about to change, read from its call arguments while it is still running (the recorded
 * result details only exist afterwards). apply_patch names its files in the patch headers; edit, write and multiedit
 * name one path, with a minus/plus preview of the replaced and the new text when the arguments carry them.
 */
export function previewFileChanges(name: string, args: unknown): FileUpdateChange[] {
  if (!isRecord(args)) return [];
  if (name === "apply_patch") {
    const text = readString(args, "input") ?? readString(args, "patch") ?? readString(args, "patchText") ?? "";
    const headers = [...text.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)];
    return headers.map((header, index) => {
      const end = headers[index + 1]?.index ?? text.length;
      const operation = header[1] === "Add" ? "add" : header[1] === "Delete" ? "delete" : "update";
      return { path: (header[2] ?? "").trim(), kind: changeKind(operation, null), diff: normalizedPatch(text.slice(header.index, end)) ?? "" };
    }).filter((change) => change.path !== "");
  }
  const filePath = readString(args, "path") ?? readString(args, "file_path") ?? readString(args, "filePath");
  if (filePath === undefined || filePath === "") return [];
  const content = readString(args, "content");
  const pairs = editPairs(args);
  const diff = content !== undefined && name === "write"
    ? prefixed(content, "+")
    : pairs.map((entry) => `${prefixed(entry.before, "-")}\n${prefixed(entry.after, "+")}`).join("\n");
  return [{ path: filePath, kind: changeKind("update", null), diff: diff === "" ? "" : `${diff}\n` }];
}
