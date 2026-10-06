import type { DiffHunk } from "@deepseek-ai/dsh-client-ui-primitives";
import type { FileUpdateChange } from "../../../shared/protocol";
import { isRecord } from "./format";

type ChangeKind = "add" | "delete" | "update";

function changeKind(kind: unknown): ChangeKind {
  const tag = typeof kind === "string" ? kind : isRecord(kind) && typeof kind["type"] === "string" ? kind["type"] : "update";
  return tag === "add" || tag === "delete" ? tag : "update";
}

function diffLines(diff: string): string[] {
  return diff.replace(/\r?\n$/, "").split(/\r?\n/);
}

function parseUnifiedDiff(path: string, diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let oldLines: string[] | null = null;
  let newLines: string[] = [];
  const flush = (): void => {
    if (oldLines !== null) hunks.push({ path, oldText: oldLines.join("\n"), newText: newLines.join("\n") });
  };
  for (const line of diffLines(diff)) {
    if (line.startsWith("@@")) {
      flush();
      oldLines = [];
      newLines = [];
      continue;
    }
    if (oldLines === null || line.startsWith("\\")) continue;
    const body = line.slice(1);
    if (line.startsWith("-")) oldLines.push(body);
    else if (line.startsWith("+")) newLines.push(body);
    else {
      oldLines.push(body);
      newLines.push(body);
    }
  }
  flush();
  return hunks;
}

/** DiffBlock input for one file change: added and deleted files carry whole contents, updates a unified diff. */
export function fileChangeHunks(change: FileUpdateChange, path: string): DiffHunk[] {
  switch (changeKind(change.kind)) {
    case "add":
      return [{ path, oldText: null, newText: change.diff }];
    case "delete":
      return [{ path, oldText: change.diff, newText: "" }];
    case "update": {
      const hunks = parseUnifiedDiff(path, change.diff);
      return hunks.length > 0 ? hunks : [{ path, oldText: null, newText: change.diff }];
    }
  }
}

export function fileChangeTotals(changes: FileUpdateChange[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const change of changes) {
    const kind = changeKind(change.kind);
    if (kind === "add" || kind === "delete") {
      const count = change.diff === "" ? 0 : diffLines(change.diff).length;
      if (kind === "add") added += count;
      else removed += count;
      continue;
    }
    let inHunk = false;
    for (const line of diffLines(change.diff)) {
      if (line.startsWith("@@")) inHunk = true;
      else if (inHunk && line.startsWith("+")) added += 1;
      else if (inHunk && line.startsWith("-")) removed += 1;
    }
  }
  return { added, removed };
}
