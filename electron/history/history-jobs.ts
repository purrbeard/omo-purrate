import { readFile, stat } from "node:fs/promises";
import type { HistoryResult, HistoryUpdate } from "../../shared/ipc";
import { parseSessionTree, type SessionTreeResult } from "../omo/session-tree";
import { HistoryUpdates } from "./history-updates";
import { parseSessionJsonl } from "./session-jsonl";

export type Job =
  | { kind: "full"; file: string }
  | { kind: "update"; file: string; since: string | null; fullFrom: number | undefined }
  | { kind: "tree"; file: string };

export type JobResult = HistoryResult | HistoryUpdate | SessionTreeResult;

const REMEMBERED_TREES = 8;

interface Tree {
  size: number;
  mtimeMs: number;
  tree: SessionTreeResult;
}

/**
 * Runs history and branch-tree reads of session files. Every read also derives the branch tree from the same text, so
 * opening a session (its history, then its tree) reads the file once; the tree is reread only when the file changed.
 */
export class HistoryJobs {
  private readonly updates = new HistoryUpdates();
  private readonly trees = new Map<string, Tree>();

  async run(job: Job): Promise<JobResult> {
    const { size, mtimeMs } = await stat(job.file);
    const known = this.trees.get(job.file);
    if (job.kind === "tree" && known !== undefined && known.size === size && known.mtimeMs === mtimeMs) return known.tree;
    const text = await readFile(job.file, "utf8");
    if (job.kind === "tree") return this.remember(job.file, size, mtimeMs, parseSessionTree(text));
    try {
      this.remember(job.file, size, mtimeMs, parseSessionTree(text));
    } catch (error) {
      // A file the tree parser rejects still has a history; the tree request rereads it and reports that error.
      void error;
      this.trees.delete(job.file);
    }
    const history = parseSessionJsonl(text);
    return job.kind === "full" ? history : this.updates.update(job.file, history, job.since, job.fullFrom);
  }

  private remember(file: string, size: number, mtimeMs: number, tree: SessionTreeResult): SessionTreeResult {
    this.trees.delete(file);
    this.trees.set(file, { size, mtimeMs, tree });
    if (this.trees.size > REMEMBERED_TREES) this.trees.delete(this.trees.keys().next().value as string);
    return tree;
  }
}
