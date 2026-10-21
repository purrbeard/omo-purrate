import { parentPort } from "node:worker_threads";
import { HistoryJobs } from "./history-jobs";
import type { HistoryJob, HistoryReply } from "./history-reader";

const port = parentPort;
if (port === null) throw new Error("history-worker must run as a worker thread");
const jobs = new HistoryJobs();

port.on("message", ({ id, ...job }: HistoryJob) => {
  void jobs.run(job).then(
    (result) => port.postMessage({ id, result } satisfies HistoryReply),
    (error: unknown) => port.postMessage({ id, error: error instanceof Error ? error.message : String(error) } satisfies HistoryReply),
  );
});
