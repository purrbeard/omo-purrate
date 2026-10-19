import { diffLines } from "diff";
import type { FileUpdateChange } from "../../../shared/protocol";
import type { ConversationItem } from "../../state";
import type { DiffHunk } from "../content/DiffBlock";
import { fileChangeHunks, fileChangeTotals } from "./diff";
import { displayPath, isRecord } from "./format";

/** Where one change to a file can be redrawn from: a recorded patch, or the replaced and written text of the call. */
export type EditSource = { change: FileUpdateChange } | { oldText: string | null; newText: string };

/** One file the turn edited; counts are null when the native call carries no text to diff. */
export interface EditedFile {
  path: string;
  added: number | null;
  removed: number | null;
  /** Every change to the file in call order; empty when no call recorded diffable text. */
  sources: EditSource[];
}

const PATH_KEYS = ["path", "file_path", "filePath"] as const;
/** omo tools that change files; their recorded result patch wins over their arguments. */
const FILE_TOOLS: ReadonlySet<string> = new Set(["edit", "write", "apply_patch", "multiedit"]);
const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gmu;

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

function editPairs(args: Record<string, unknown>): { oldText: string; newText: string }[] {
  const edits = Array.isArray(args["edits"]) ? args["edits"].filter(isRecord) : [args];
  return edits.flatMap((edit) => {
    const oldText = stringField(edit, ["oldText", "old_string", "oldString"]);
    const newText = stringField(edit, ["newText", "new_string", "newString"]);
    return oldText === null || newText === null ? [] : [{ oldText, newText }];
  });
}

/** Line counts and redraw sources of an edit/write call from its recorded arguments; null when they hold no diffable text. */
function argumentChange(tool: string, args: Record<string, unknown>): { added: number; removed: number; sources: EditSource[] } | null {
  if (tool === "write") {
    const content = args["content"];
    return typeof content === "string" ? { added: lineCount(content), removed: 0, sources: [{ oldText: null, newText: content }] } : null;
  }
  const pairs = editPairs(args);
  if (pairs.length === 0) return null;
  return pairs.reduce((sum, pair) => {
    const counts = pairCounts(pair.oldText, pair.newText);
    return { added: sum.added + counts.added, removed: sum.removed + counts.removed, sources: [...sum.sources, pair] };
  }, { added: 0, removed: 0, sources: [] as EditSource[] });
}

/** Files an apply_patch call names in its `*** Add/Update/Delete File:` headers. */
function patchPaths(args: Record<string, unknown>): string[] {
  const text = stringField(args, ["input", "patch", "patchText"]);
  if (text === null) return [];
  return [...new Set([...text.matchAll(PATCH_FILE)].flatMap((match) => {
    const path = match[1]?.trim() ?? "";
    return path === "" ? [] : [path];
  }))];
}

function merge(files: Map<string, EditedFile>, path: string, counts: { added: number; removed: number } | null, sources: EditSource[]): void {
  const previous = files.get(path);
  if (previous === undefined) {
    files.set(path, { path, added: counts?.added ?? null, removed: counts?.removed ?? null, sources });
    return;
  }
  const merged = [...previous.sources, ...sources];
  files.set(path, counts === null
    ? { ...previous, sources: merged }
    : { path, added: (previous.added ?? 0) + counts.added, removed: (previous.removed ?? 0) + counts.removed, sources: merged });
}

function mergeChanges(files: Map<string, EditedFile>, changes: readonly FileUpdateChange[], cwd: string | null): void {
  for (const change of changes) merge(files, displayPath(change.path, cwd), fileChangeTotals([change]), [{ change }]);
}

/**
 * Files a turn changed, in first-touch order: native fileChange items and settled, successful file tool calls
 * (edit, write, apply_patch, multiedit). A call's recorded result patch wins over its arguments.
 * Failed, declined or still-running calls changed nothing yet and are left out.
 */
export function editedFiles(items: readonly ConversationItem[], cwd: string | null): EditedFile[] {
  const files = new Map<string, EditedFile>();
  for (const { item } of items) {
    if (item.type === "fileChange") {
      if (item.status === "completed") mergeChanges(files, item.changes, cwd);
      continue;
    }
    if (item.type !== "dynamicToolCall" || !FILE_TOOLS.has(item.tool)) continue;
    if (item.status !== "completed" || item.success === false) continue;
    if (item.changes !== undefined && item.changes.length > 0) {
      mergeChanges(files, item.changes, cwd);
      continue;
    }
    if (!isRecord(item.arguments)) continue;
    if (item.tool === "apply_patch") {
      for (const path of patchPaths(item.arguments)) merge(files, displayPath(path, cwd), null, []);
      continue;
    }
    const path = stringField(item.arguments, PATH_KEYS);
    if (path === null || path.trim() === "") continue;
    const change = argumentChange(item.tool, item.arguments);
    merge(files, displayPath(path, cwd), change, change?.sources ?? []);
  }
  return [...files.values()];
}

/** DiffBlock input for one edited file, labelled with its display path. */
export function editedFileHunks(file: EditedFile): DiffHunk[] {
  return file.sources.flatMap((source) => "change" in source
    ? fileChangeHunks(source.change, file.path)
    : [{ path: file.path, oldText: source.oldText, newText: source.newText }]);
}
