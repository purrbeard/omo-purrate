import { readFileSync } from "node:fs";
import type { RpcNotification, Thread } from "../../shared/protocol";
import type { AppEvent } from "../../src/state";

export const PROBE_THREAD_ID = "01a0f5a8-38d1-79a4-b23f-50f6a7b29bcb";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function probeNotificationEvents(): AppEvent[] {
  const text = readFileSync(new URL("../fixtures/appserver-probe.jsonl", import.meta.url), "utf8");
  const events: AppEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    const frame: unknown = JSON.parse(line);
    if (!isRecord(frame) || frame["tag"] !== "A" || frame["dir"] !== "in") continue;
    const msg = frame["msg"];
    const t = frame["t"];
    if (!isRecord(msg) || typeof t !== "number" || "id" in msg) continue;
    const method = msg["method"];
    if (typeof method !== "string") continue;
    const notification: RpcNotification = { method, params: msg["params"] };
    events.push({ type: "rpc/notification", notification, receivedAtMs: t });
  }
  return events;
}

export function notification(method: string, params: unknown, receivedAtMs = 1_000): AppEvent {
  return { type: "rpc/notification", notification: { method, params }, receivedAtMs };
}

export function makeThread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    preview: "",
    createdAt: 1_790_000_000,
    updatedAt: 1_790_000_000,
    status: { type: "idle" },
    path: `/Users/me/.omo/agent/sessions/${id}.jsonl`,
    cwd: "/tmp/work/project",
    source: "appServer",
    name: null,
    turns: [],
    ...overrides,
  };
}
