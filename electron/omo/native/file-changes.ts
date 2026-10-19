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
