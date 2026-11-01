import { stat } from "node:fs/promises";
import type { HistoryResult, HistoryUpdate } from "../../shared/ipc";
import { SessionTreeParser, type SessionTreeResult } from "../omo/session-tree";
import { HistoryUpdates } from "./history-updates";
import { SessionJsonlParser } from "./session-jsonl";
import { readSessionLines } from "./session-lines";

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
 * Runs history and branch-tree reads of session files. Every read also derives the branch tree from the same records, so
 * opening a session (its history, then its tree) reads the file once; the tree is reread only when the file changed.
 */
export class HistoryJobs {
  private readonly updates = new HistoryUpdates();
  private readonly trees = new Map<string, Tree>();

  async run(job: Job): Promise<JobResult> {
    const { size, mtimeMs } = await stat(job.file);
    const known = this.trees.get(job.file);
    if (job.kind === "tree" && known !== undefined && known.size === size && known.mtimeMs === mtimeMs) return known.tree;
    const historyParser = new SessionJsonlParser();
    let treeParser: SessionTreeParser | null = new SessionTreeParser();
    let treeError: unknown;
    for await (const line of readSessionLines(job.file)) {
      if (job.kind !== "tree") historyParser.add(line);
      if (treeParser !== null) {
        try { treeParser.add(line); }
        catch (error) { treeError = error; treeParser = null; }
      }
    }
    if (job.kind === "tree") {
      if (treeParser === null) throw treeError;
      return this.remember(job.file, size, mtimeMs, treeParser.result());
    }
    try {
      if (treeParser === null) throw treeError;
      this.remember(job.file, size, mtimeMs, treeParser.result());
    } catch (error) {
      // A file the tree parser rejects still has a history; the tree request rereads it and reports that error.
      void error;
      this.trees.delete(job.file);
    }
    const history = historyParser.result();
    return job.kind === "full" ? history : this.updates.update(job.file, history, job.since, job.fullFrom);
  }

  private remember(file: string, size: number, mtimeMs: number, tree: SessionTreeResult): SessionTreeResult {
    this.trees.delete(file);
    this.trees.set(file, { size, mtimeMs, tree });
    if (this.trees.size > REMEMBERED_TREES) this.trees.delete(this.trees.keys().next().value as string);
    return tree;
  }
}
