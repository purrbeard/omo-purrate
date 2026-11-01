import { afterEach, expect, it, vi } from "vitest";
import type { RpcNotification } from "../../shared/protocol";
import { createNotificationStream } from "../../electron/notification-stream";

afterEach(() => vi.useRealTimers());

it.each(["item/agentMessage/delta", "item/reasoning/textDelta", "item/reasoning/summaryTextDelta", "item/commandExecution/outputDelta"])("preserves adjacent %s bytes and the latest timestamp while bounding IPC delivery to a frame", (method) => {
  vi.useFakeTimers();
  const received: RpcNotification[] = [];
  const stream = createNotificationStream(notification => received.push(notification));
  const params = { threadId: "thread", turnId: "turn", itemId: "answer" };
  stream.push({ method, params: { ...params, delta: "한" }, emittedAtMs: 1 });
  stream.push({ method, params: { ...params, delta: "글\n" }, emittedAtMs: 2 });
  expect(received).toEqual([]);
  vi.runOnlyPendingTimers();
  expect(received).toEqual([{ method, params: { ...params, delta: "한글\n" }, emittedAtMs: 2 }]);
});

it("delivers a sustained token stream in frames without losing or reordering text", () => {
  vi.useFakeTimers();
  const received: string[] = [];
  const send = vi.fn((notification: RpcNotification) => {
    const params = notification.params;
    if (typeof params === "object" && params !== null && "delta" in params && typeof params.delta === "string") received.push(params.delta);
  });
  const stream = createNotificationStream(send);
  const chunks = Array.from({ length: 80 }, (_, index) => `${index},`);
  for (const delta of chunks) {
    stream.push({ method: "item/agentMessage/delta", params: { threadId: "a", turnId: "t", itemId: "i", delta } });
    vi.advanceTimersByTime(2);
  }
  stream.flush();
  expect(received.join("")).toBe(chunks.join(""));
  expect(send).toHaveBeenCalledTimes(5);
});

it("flushes text before lifecycle events and keeps different items, threads and reasoning indexes separate", () => {
  vi.useFakeTimers();
  const received: RpcNotification[] = [];
  const stream = createNotificationStream(notification => received.push(notification));
  const events: RpcNotification[] = [
    { method: "item/reasoning/textDelta", params: { threadId: "a", turnId: "turn", itemId: "x", contentIndex: 0, delta: "one" } },
    { method: "item/reasoning/textDelta", params: { threadId: "a", turnId: "turn", itemId: "x", contentIndex: 1, delta: "two" } },
    { method: "item/reasoning/textDelta", params: { threadId: "b", turnId: "turn", itemId: "x", contentIndex: 1, delta: "three" } },
    { method: "item/reasoning/textDelta", params: { threadId: "b", turnId: "turn", itemId: "y", contentIndex: 1, delta: "four" } },
    { method: "turn/completed", params: { threadId: "b", turn: { id: "turn" } } },
  ];
  for (const event of events) stream.push(event);
  vi.runOnlyPendingTimers();
  expect(received).toEqual(events);
});

it("explicitly flushes pending output before requests or disposal without a later duplicate", () => {
  vi.useFakeTimers();
  const send = vi.fn();
  const stream = createNotificationStream(send);
  const event = { method: "item/commandExecution/outputDelta", params: { threadId: "a", turnId: "t", itemId: "cmd", delta: "output" } };
  stream.push(event);
  stream.flush();
  vi.runOnlyPendingTimers();
  expect(send).toHaveBeenCalledExactlyOnceWith(event);
});
