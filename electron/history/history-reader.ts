import { readFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import type { HistoryResult, HistoryUpdate } from "../../shared/ipc";
import { HistoryUpdates } from "./history-updates";
import { parseSessionJsonl } from "./session-jsonl";

type Job = { kind: "full"; file: string } | { kind: "update"; file: string; since: string | null; fullFrom: number | undefined };

export type HistoryJob = Job & { id: number };

export type HistoryReply = { id: number; result: HistoryResult | HistoryUpdate } | { id: number; error: string };

interface Pending {
  job: Job;
  resolve(result: HistoryResult | HistoryUpdate): void;
  reject(error: Error): void;
}

/**
 * Reads and parses session JSONL files on a worker thread, so a reread of a session hundreds of MB long does not block
 * the main process (and every IPC reply behind it). When the worker cannot start or dies, reads run in-process.
 */
export class HistoryReader {
  private worker: Worker | null = null;
  private broken = false;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly inline = new HistoryUpdates();

  constructor(private readonly workerPath: string) {}

  full(file: string): Promise<HistoryResult> {
    return this.run({ kind: "full", file }) as Promise<HistoryResult>;
  }

  update(file: string, since: string | null, fullFrom: number | undefined): Promise<HistoryUpdate> {
    return this.run({ kind: "update", file, since, fullFrom }) as Promise<HistoryUpdate>;
  }

  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.broken = true;
    if (worker !== null) await worker.terminate();
  }

  private run(job: Job): Promise<HistoryResult | HistoryUpdate> {
    const worker = this.started();
    if (worker === null) return this.runInline(job);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { job, resolve, reject });
      worker.postMessage({ ...job, id } satisfies HistoryJob);
    });
  }

  private async runInline(job: Job): Promise<HistoryResult | HistoryUpdate> {
    const history = parseSessionJsonl(await readFile(job.file, "utf8"));
    return job.kind === "full" ? history : this.inline.update(job.file, history, job.since, job.fullFrom);
  }

  private started(): Worker | null {
    if (this.broken) return null;
    if (this.worker !== null) return this.worker;
    try {
      const worker = new Worker(this.workerPath);
      worker.unref();
      worker.on("message", (reply: HistoryReply) => {
        const entry = this.pending.get(reply.id);
        if (entry === undefined) return;
        this.pending.delete(reply.id);
        if ("error" in reply) entry.reject(new Error(reply.error));
        else entry.resolve(reply.result);
      });
      worker.on("error", (error) => this.fail(error));
      worker.on("exit", (code) => { if (this.worker === worker) this.fail(new Error(`history worker exited with ${code}`)); });
      this.worker = worker;
      return worker;
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  /** Reads still waiting on a dead worker run in-process, like every read after it. */
  private fail(error: unknown): void {
    if (this.broken) return;
    console.warn(`[omo-ui] history worker unavailable, reading sessions in-process: ${error instanceof Error ? error.message : String(error)}`);
    this.broken = true;
    this.worker = null;
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const entry of waiting) this.runInline(entry.job).then(entry.resolve, entry.reject);
  }
}
