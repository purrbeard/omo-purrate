import { useEffect, useState } from "react";

/** Name of the extension_event the native client sends when omo's steering/follow-up queue changes. */
export const QUEUE_EVENT = "omo.queue.updated";

/** One input omo holds for the thread; `queuedId` is null when omo reported only the text lists (no withdraw or edit). */
export interface QueuedMessage {
  queuedId: string | null;
  mode: "steer" | "followUp";
  text: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The thread and queue a notification carries, or null when it is not a queue update. */
export function parseQueueNotification(notification: { method: string; params?: unknown }): { threadId: string; items: QueuedMessage[] } | null {
  const params = notification.params;
  if (notification.method !== "extension_event" || !isObject(params) || params["name"] !== QUEUE_EVENT) return null;
  const data = params["data"];
  const threadId = params["threadId"];
  if (typeof threadId !== "string" || !isObject(data) || !Array.isArray(data["items"])) return null;
  const items = data["items"].flatMap((row): QueuedMessage[] => {
    if (!isObject(row) || typeof row["text"] !== "string") return [];
    return [{
      queuedId: typeof row["queuedId"] === "string" ? row["queuedId"] : null,
      mode: row["mode"] === "followUp" ? "followUp" : "steer",
      text: row["text"],
    }];
  });
  return { threadId, items };
}

/** The pending queue of a thread, kept from omo's queue updates for as long as the composer is mounted. */
export function useQueuedMessages(threadId: string | null): readonly QueuedMessage[] {
  const [queues, setQueues] = useState<Record<string, readonly QueuedMessage[]>>({});
  useEffect(() => window.omo.onNotification((notification) => {
    const update = parseQueueNotification(notification);
    if (update !== null) setQueues((current) => ({ ...current, [update.threadId]: update.items }));
  }), []);
  return (threadId === null ? undefined : queues[threadId]) ?? [];
}
