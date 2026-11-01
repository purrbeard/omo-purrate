import { open, stat } from "node:fs/promises";
import type { HistoryResult, HistoryUpdate } from "../../shared/ipc";
import { SessionTreeParser, type SessionTreeResult } from "../omo/session-tree";
import { HistoryUpdates } from "./history-updates";
import { SessionJsonlParser } from "./session-jsonl";
import { readSessionRecords } from "./session-lines";
import { sessionOutline } from "./session-outline";
import { ContextUsageParser } from "../workbench/context-usage";
import type { ContextUsage } from "../../shared/workbench";

export type Job =
  | { kind: "full"; file: string }
  | { kind: "update"; file: string; since: string | null; fullFrom: number | undefined }
  | { kind: "page"; file: string; from: number; count: number }
  | { kind: "entry"; file: string; entryId: string }
  | { kind: "context"; file: string }
  | { kind: "tool"; file: string; turnId: string; toolId: string }
  | { kind: "tree"; file: string };

export type JobResult = HistoryResult | HistoryUpdate | SessionTreeResult | ContextUsage;

const REMEMBERED_TREES = 8;

interface Tree {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
  dev: number;
  complete: boolean;
  historyParser: SessionJsonlParser;
  treeParser: SessionTreeParser | null;
  treeError?: unknown;
  tree: SessionTreeResult | null;
  offsets: Map<string, { start: number; end: number }>;
  context: ContextUsageParser;
  projections: Map<string, HistoryResult>;
}

/**
 * Runs history and branch-tree reads of session files. Every read also derives the branch tree from the same records, so
 * opening a session (its history, then its tree) reads the file once; the tree is reread only when the file changed.
 */
export class HistoryJobs {
  private readonly updates = new HistoryUpdates();
  private readonly trees = new Map<string, Tree>();

  async run(job: Job): Promise<JobResult> {
    const info = await stat(job.file);
    const { size, mtimeMs, ctimeMs, ino, dev } = info;
    const verifySnapshot = async (): Promise<void> => {
      const current = await stat(job.file);
      if (current.ino !== ino || current.dev !== dev || current.size < size || current.mtimeMs < mtimeMs
        || (current.size === size && (current.mtimeMs !== mtimeMs || current.ctimeMs !== ctimeMs))) {
        this.trees.delete(job.file);
        throw new Error("session changed while reading its history snapshot");
      }
    };
    const known = this.trees.get(job.file);
    for (const [file, tree] of this.trees) if (file !== job.file) { tree.historyParser.releasePayload(); tree.projections.clear(); }
    const reusable = known !== undefined && known.complete && known.ino === ino && known.dev === dev && known.size <= size
      && known.mtimeMs <= mtimeMs && (known.size !== size || known.ctimeMs === ctimeMs);
    const unchanged = reusable && known.size === size && known.mtimeMs === mtimeMs;
    if (unchanged && job.kind === "tree") { if (known.tree === null) throw known.treeError; return known.tree; }
    if (unchanged && job.kind === "context") return known.context.result();
    const projectionKey = job.kind === "update" ? `update:${job.fullFrom ?? 0}` : job.kind === "page" ? `page:${job.from}:${job.count}` : job.kind;
    const cached = unchanged ? known.projections.get(projectionKey) : undefined;
    if (cached !== undefined) {
      return job.kind === "update" ? this.updates.update(job.file, cached, job.since, job.fullFrom) : cached;
    }
    let historyParser = reusable ? known.historyParser : new SessionJsonlParser();
    let treeParser = reusable ? known.treeParser : new SessionTreeParser();
    let treeError: unknown = reusable ? known.treeError : undefined;
    let complete = true;
    let branchChanged = false;
    let offsets = reusable ? known.offsets : new Map<string, { start: number; end: number }>();
    let context = reusable ? known.context : new ContextUsageParser();
    const add = (line: string, start: number, end: number): void => {
      const outline = sessionOutline(line);
      context.add(outline);
      branchChanged = historyParser.add(outline) || branchChanged;
      const identity: unknown = JSON.parse(outline || "null");
      if (typeof identity === "object" && identity !== null && "id" in identity && typeof identity.id === "string") offsets.set(identity.id, { start, end });
      if (treeParser !== null) {
        try { treeParser.add(outline); }
        catch (error) { treeError = error; treeParser = null; }
      }
    };
    const start = reusable ? known.size : 0;
    // A failed read must not publish a partly mutated checkpoint.
    if (start < size) this.trees.delete(job.file);
    for await (const record of readSessionRecords(job.file, start, size)) {
      complete = record.complete;
      add(record.line, record.start, record.end);
    }
    // A branch-changing append cannot reuse the previous branch's derived state.
    if (reusable && branchChanged) {
      historyParser = new SessionJsonlParser();
      treeParser = new SessionTreeParser();
      treeError = undefined;
      offsets = new Map();
      context = new ContextUsageParser();
      for await (const record of readSessionRecords(job.file, 0, size)) {
        complete = record.complete;
        add(record.line, record.start, record.end);
      }
    }
    await verifySnapshot();
    let tree = unchanged ? known.tree : null;
    if (!unchanged && treeParser !== null) {
      try { tree = treeParser.result(); }
      catch (error) { treeError = error; treeParser = null; }
    }
    this.trees.delete(job.file);
    this.trees.set(job.file, { size, mtimeMs, ctimeMs, ino, dev, complete, historyParser, treeParser, treeError, tree, offsets, context, projections: unchanged ? known.projections : new Map() });
    if (this.trees.size > REMEMBERED_TREES) {
      const oldest = this.trees.keys().next().value;
      if (oldest !== undefined) this.trees.delete(oldest);
    }
    if (job.kind === "tree") { if (tree === null) throw treeError; return tree; }
    if (job.kind === "context") return context.result();
    if (job.kind === "entry") {
      const span = offsets.get(job.entryId);
      if (span === undefined) throw new Error("session entry no longer exists");
      const handle = await open(job.file, "r");
      try {
        const buffer = Buffer.allocUnsafe(span.end - span.start);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, span.start);
        if (bytesRead !== buffer.length) throw new Error("session changed while reading its entry");
        await verifySnapshot();
        const parser = new SessionTreeParser();
        parser.add(buffer.toString("utf8"));
        return parser.result();
      } finally { await handle.close(); }
    }
    const summary = historyParser.result();
    const total = summary.turns.length;
    const requested = job.kind === "update" ? job.fullFrom ?? 0 : job.kind === "page" ? job.from : 0;
    const from = Math.min(total, Math.max(0, requested < 0 ? total + requested : requested));
    const allIds = job.kind === "tool" ? historyParser.toolEntries(job.toolId) : historyParser.pageEntries(from, job.kind === "page" ? job.count : undefined);
    const deferred = new Set<string>();
    const ids = allIds.filter(id => {
      const span = offsets.get(id);
      if (job.kind !== "tool" && job.kind !== "full" && historyParser.payloadRole(id) === "toolResult" && span !== undefined && span.end - span.start > 64_000) {
        const toolId = historyParser.toolResultId(id);
        if (toolId !== null) deferred.add(toolId);
        return false;
      }
      return true;
    });
    const records: string[] = [];
    const handle = await open(job.file, "r");
    try {
      for (const id of ids) {
        if (!historyParser.needsPayload(id)) continue;
        const span = offsets.get(id);
        if (span === undefined) throw new Error("session history index no longer matches its page");
        const buffer = Buffer.allocUnsafe(span.end - span.start);
        let read = 0;
        while (read < buffer.length) {
          const { bytesRead } = await handle.read(buffer, read, buffer.length - read, span.start + read);
          if (bytesRead === 0) throw new Error("session changed while reading its history page");
          read += bytesRead;
        }
        records.push(buffer.toString("utf8"));
      }
    } finally { await handle.close(); }
    await verifySnapshot();
    const history = ids.length === 0 ? summary : historyParser.result(records, ids);
    if (deferred.size > 0) for (const turn of history.turns) for (const item of turn.items) {
      if (item.type === "dynamicToolCall" && deferred.has(item.id)) item.historyRef = { file: job.file, turnId: turn.id };
    }
    if (job.kind === "tool") return { ...history, turns: history.turns.filter(turn => turn.id === job.turnId) };
    const result = job.kind === "page" ? { ...history, turns: history.turns.slice(from, from + job.count) } : history;
    const retained = this.trees.get(job.file);
    if (retained !== undefined) {
      retained.projections.set(projectionKey, result);
      if (retained.projections.size > 3) {
        const oldest = retained.projections.keys().next().value;
        if (oldest !== undefined) retained.projections.delete(oldest);
      }
    }
    if (job.kind === "page") return result;
    return job.kind === "full" ? history : this.updates.update(job.file, history, job.since, job.fullFrom);
  }
}
