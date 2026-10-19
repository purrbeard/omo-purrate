import { diffLines } from "diff";
import type { ConversationItem } from "../../state";
import { fileChangeTotals } from "./diff";
import { displayPath, isRecord } from "./format";

/** One file the turn edited; counts are null when the native call carries no text to diff. */
export interface EditedFile {
  path: string;
  added: number | null;
  removed: number | null;
}

const PATH_KEYS = ["path", "file_path", "filePath"] as const;

function stringField(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function lineCount(text: string): number {
  return text === "" ? 0 : text.replace(/\r?\n$/, "").split(/\r?\n/).length;
}

function pairCounts(before: string, after: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const part of diffLines(before, after)) {
    if (part.added) added += part.count;
    else if (part.removed) removed += part.count;
  }
  return { added, removed };
}

/** Line counts of an edit/write call from its recorded arguments; null when they hold no diffable text. */
function toolCounts(tool: string, args: Record<string, unknown>): { added: number; removed: number } | null {
  if (tool === "write") {
    const content = args["content"];
    return typeof content === "string" ? { added: lineCount(content), removed: 0 } : null;
  }
  const edits = Array.isArray(args["edits"]) ? args["edits"].filter(isRecord) : [args];
  const pairs = edits.flatMap((edit) => {
    const before = stringField(edit, ["oldText", "old_string", "oldString"]);
    const after = stringField(edit, ["newText", "new_string", "newString"]);
    return before === null || after === null ? [] : [pairCounts(before, after)];
  });
  if (pairs.length === 0) return null;
  return pairs.reduce((sum, counts) => ({ added: sum.added + counts.added, removed: sum.removed + counts.removed }));
}

function merge(files: Map<string, EditedFile>, path: string, counts: { added: number; removed: number } | null): void {
  const previous = files.get(path);
  if (previous === undefined) {
    files.set(path, { path, added: counts?.added ?? null, removed: counts?.removed ?? null });
    return;
  }
  if (counts === null) return;
  files.set(path, { path, added: (previous.added ?? 0) + counts.added, removed: (previous.removed ?? 0) + counts.removed });
}

/**
 * Files a turn changed, in first-touch order: native fileChange items and settled, successful edit/write
 * tool calls. Failed, declined or still-running calls changed nothing yet and are left out.
 */
export function editedFiles(items: readonly ConversationItem[], cwd: string | null): EditedFile[] {
  const files = new Map<string, EditedFile>();
  for (const { item } of items) {
    if (item.type === "fileChange") {
      if (item.status !== "completed") continue;
      for (const change of item.changes) merge(files, displayPath(change.path, cwd), fileChangeTotals([change]));
      continue;
    }
    if (item.type !== "dynamicToolCall" || (item.tool !== "edit" && item.tool !== "write")) continue;
    if (item.status !== "completed" || item.success === false || !isRecord(item.arguments)) continue;
    const path = stringField(item.arguments, PATH_KEYS);
    if (path === null || path.trim() === "") continue;
    merge(files, displayPath(path, cwd), toolCounts(item.tool, item.arguments));
  }
  return [...files.values()];
}
