import { readFile } from "node:fs/promises";
import { parentPort } from "node:worker_threads";
import { HistoryUpdates } from "./history-updates";
import type { HistoryJob, HistoryReply } from "./history-reader";
import { parseSessionJsonl } from "./session-jsonl";

const port = parentPort;
if (port === null) throw new Error("history-worker must run as a worker thread");
const updates = new HistoryUpdates();

port.on("message", (job: HistoryJob) => {
  void readFile(job.file, "utf8").then(
    (text) => {
      const history = parseSessionJsonl(text);
      const result = job.kind === "full" ? history : updates.update(job.file, history, job.since, job.fullFrom);
      port.postMessage({ id: job.id, result } satisfies HistoryReply);
    },
    (error: unknown) => port.postMessage({ id: job.id, error: error instanceof Error ? error.message : String(error) } satisfies HistoryReply),
  );
});
