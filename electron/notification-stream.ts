import type { RpcNotification } from "../shared/protocol";

const STREAM_FRAME_MS = 32;
const DELTA_METHODS = new Set([
  "item/agentMessage/delta", "item/reasoning/textDelta", "item/reasoning/summaryTextDelta", "item/commandExecution/outputDelta",
]);

/** Coalesce adjacent text deltas before IPC so a fast producer cannot queue a renderer task per token. */
export function createNotificationStream(send: (notification: RpcNotification) => void) {
  let pending: { notification: RpcNotification; params: Record<string, unknown>; key: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const current = pending;
    pending = null;
    if (current !== null) send(current.notification);
  };
  return {
    flush,
    push(notification: RpcNotification): void {
      const params = notification.params;
      if (!DELTA_METHODS.has(notification.method) || typeof params !== "object" || params === null || !("delta" in params) || typeof params.delta !== "string") {
        flush();
        send(notification);
        return;
      }
      const fields = { ...params };
      delete fields.delta;
      const key = JSON.stringify([notification.method, fields]);
      if (pending !== null && pending.key === key) {
        const merged = { ...pending.params, delta: String(pending.params.delta) + params.delta };
        pending = { notification: { ...notification, params: merged }, params: merged, key };
        return;
      }
      flush();
      const copied = { ...params };
      pending = { notification: { ...notification, params: copied }, params: copied, key };
      timer = setTimeout(flush, STREAM_FRAME_MS);
    },
  };
}
