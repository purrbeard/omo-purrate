import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { IPC } from "../shared/ipc.ts";
import type { RpcNotification } from "../shared/protocol.ts";
import { byTestId, launchApp, manageThread, threadRow, type LaunchedApp } from "./helpers.ts";
import { TESTID } from "../src/ui/testids.ts";

/** Subscribe before sending; the final name event fences all preceding notification listeners. */
async function emit(launched: LaunchedApp, threadId: string, notifications: RpcNotification[]): Promise<void> {
  const signal = `selected-status:${randomUUID()}`;
  const received = launched.page.waitForEvent("console", { predicate: message => message.text() === signal, timeout: 10_000 });
  await launched.page.evaluate(({ signal }) => {
    const unsubscribe = window.omo.onNotification(notification => {
      const params = notification.params;
      if (notification.method === "thread/name/updated" && typeof params === "object" && params !== null && "threadName" in params && params.threadName === signal) {
        unsubscribe();
        console.log(signal);
      }
    });
  }, { signal });
  await launched.app.evaluate(({ BrowserWindow }, { channel, notifications, threadId, signal }) => {
    const contents = BrowserWindow.getAllWindows()[0]!.webContents;
    for (const notification of notifications) contents.send(channel, notification);
    contents.send(channel, { method: "thread/name/updated", params: { threadId, threadName: signal } });
  }, { channel: IPC.notification, notifications, threadId, signal });
  await received;
}

async function createThread(launched: LaunchedApp): Promise<string> {
  const threadId = await launched.page.evaluate(async cwd => {
    const result = await window.omo.request("thread/start", { cwd });
    return result.thread.id;
  }, launched.dirs.fakeHome!);
  await manageThread(launched.page, threadId);
  return threadId;
}

test("sidebar elapsed uses the active turn, resets for a new turn, and omits unknown starts", async () => {
  const launched = await launchApp({ omo: "fake" });
  try {
    const { page } = launched;
    const threadId = await createThread(launched);
    const idleId = await createThread(launched);
    const row = threadRow(page, threadId);
    const status = row.getByTestId("thread-running-status");
    const now = new Date("2026-10-07T12:00:00Z");
    await page.clock.install({ time: new Date(now.getTime() - 1000) });
    await page.clock.pauseAt(now);
    await emit(launched, threadId, [{ method: "thread/status/changed", params: { threadId, status: { type: "active", activeFlags: [] } } }]);
    await expect(status).toHaveText("Working");
    await expect(threadRow(page, idleId).getByTestId("thread-running-status")).toHaveCount(0);
    const turn = { id: "elapsed-turn", items: [], status: "inProgress" as const, error: null, startedAt: now.getTime() / 1000 - 3, completedAt: null };
    await emit(launched, threadId, [{ method: "turn/started", params: { threadId, turn } }]);
    await expect(status).toHaveText("Running 3s");
    await page.clock.runFor(1000);
    await expect(status).toHaveText("Running 4s");
    await emit(launched, threadId, [
      { method: "turn/completed", params: { threadId, turn: { ...turn, status: "completed", completedAt: now.getTime() / 1000 + 1 } } },
      { method: "thread/status/changed", params: { threadId, status: { type: "idle" } } },
    ]);
    await expect(status).toHaveCount(0);
    await emit(launched, threadId, [
      { method: "thread/status/changed", params: { threadId, status: { type: "active", activeFlags: [] } } },
      { method: "turn/started", params: { threadId, turn: { ...turn, id: "next-turn", startedAt: now.getTime() / 1000 } } },
    ]);
    await expect(status).toHaveText("Running 1s");
    await emit(launched, threadId, [{ method: "thread/status/changed", params: { threadId, status: { type: "idle" } } }]);
    await expect(status).toHaveCount(0);
  } finally {
    await launched.close();
  }
});

test("side outcomes produce neither system notifications nor main toasts, while main outcomes still notify", async () => {
  const launched = await launchApp({ omo: "fake" });
  try {
    const { page, app } = launched;
    const threadId = await createThread(launched);
    await threadRow(page, threadId).getByRole("button").first().click();
    await byTestId(page, TESTID.openSettings).click();
    await byTestId(page, TESTID.settingsThreadNotifications).getByRole("tab", { name: "Always" }).click();
    await page.keyboard.press("Escape");
    await app.evaluate(({ ipcMain }, channel) => {
      const notifications: unknown[] = [];
      (globalThis as typeof globalThis & { selectedStatusNotifications: unknown[] }).selectedStatusNotifications = notifications;
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (_event, payload: unknown) => { notifications.push(payload); });
    }, IPC.notify);
    const side = await page.evaluate(async cwd => {
      const result = await window.omo.request("thread/start", { cwd });
      return result.thread;
    }, launched.dirs.fakeHome!);
    const turn = { id: "side-outcome", items: [], status: "completed" as const, error: null, startedAt: null, completedAt: null };
    await emit(launched, threadId, [
      { method: "thread/started", params: { thread: { ...side, preview: "[OmO UI side chat background]" } } },
      { method: "turn/completed", params: { threadId: side.id, turn } },
      { method: "turn/completed", params: { threadId: side.id, turn: { ...turn, id: "side-failure", status: "failed", error: { message: "side error", codexErrorInfo: null, additionalDetails: null } } } },
    ]);
    // This IPC round trip also fences any app:notify invocations issued by the notification listeners.
    await page.evaluate(() => window.omo.getStatus());
    await expect(byTestId(page, TESTID.noticeToast)).toHaveCount(0);
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { selectedStatusNotifications: unknown[] }).selectedStatusNotifications)).toEqual([]);
    const workerId = await createThread(launched);
    await emit(launched, threadId, [{ method: "turn/completed", params: { threadId: workerId, turn: { ...turn, id: "main-outcome" } } }]);
    await page.evaluate(() => window.omo.getStatus());
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { selectedStatusNotifications: unknown[] }).selectedStatusNotifications)).toEqual([expect.objectContaining({ threadId: workerId, body: "Turn finished" })]);
  } finally {
    await launched.close();
  }
});
