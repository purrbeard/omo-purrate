import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { quarantineSync } from "../scripts/quarantine-temp.mjs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, shot, tempDir, threadRow } from "./helpers.ts";

const THREAD = "sync-thread";

function line(entry: Record<string, unknown>): string {
  return JSON.stringify(entry) + "\n";
}

function message(id: string, parentId: string | null, role: "user" | "assistant", text: string): string {
  return line({ type: "message", id, parentId, timestamp: new Date().toISOString(),
    message: { role, content: [{ type: "text", text }], ...(role === "assistant" ? { stopReason: "stop" } : {}) } });
}

test("an open session follows what another omo process appends to its file", async () => {
  const fakeHome = tempDir("sync-home");
  const pickDir = tempDir("sync-workspace");
  const dir = path.join(fakeHome, "sessions");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${THREAD}.jsonl`);
  writeFileSync(file, line({ type: "session", version: 3, id: THREAD, timestamp: new Date().toISOString(), cwd: pickDir })
    + message("u1", null, "user", "Question asked in OmO UI") + message("a1", "u1", "assistant", "Answer shown in OmO UI"));
  const launched = await launchApp({ omo: "fake", fakeHome, pickDir, managed: [THREAD] });
  try {
    const { page } = launched;
    await threadRow(page, THREAD).getByRole("button").first().click();
    await expect(page.getByText("Answer shown in OmO UI")).toBeVisible();

    // A torn trailing line, as a writer mid-append leaves it, must not break the view.
    appendFileSync(file, message("u2", "a1", "user", "Question typed in the terminal") + '{"type":"message","id":"a2","par');
    await expect(page.getByText("Question typed in the terminal")).toBeVisible();
    await expect(byTestId(page, TESTID.noticeToast).first()).toBeVisible();

    appendFileSync(file, 'entId":"u2"}\n' + message("a2b", "u2", "assistant", "Answer written by the terminal"));
    await expect(page.getByText("Answer written by the terminal")).toBeVisible();
    await expect(page.getByText("Answer shown in OmO UI")).toBeVisible();

    appendFileSync(file, line({ type: "model_change", id: "m1", parentId: "a2b", timestamp: new Date().toISOString(), provider: "fake", modelId: "beta" }));
    await expect(byTestId(page, TESTID.modelPicker)).toContainText("Fake Beta");
    await shot(page, "session-sync");

    // File tool results the terminal recorded are the session's change history, independent of git.
    const inside = `${pickDir.replaceAll("\\", "/")}/src/app.ts`;
    const outside = path.join(fakeHome, "notes.md");
    const patch = `--- ${inside}\n+++ ${inside}\n@@ -1,2 +1,2 @@\n keep\n-old line\n+new line\n`;
    const at = new Date().toISOString();
    appendFileSync(file, message("u3", "m1", "user", "Edit files from the terminal")
      + line({ type: "message", id: "a3", parentId: "u3", timestamp: at, message: { role: "assistant", stopReason: "toolUse", content: [
        { type: "toolCall", id: "edit-1", name: "edit", arguments: { path: inside, edits: [{ oldText: "old line", newText: "new line" }] } },
        { type: "toolCall", id: "write-1", name: "write", arguments: { path: outside, content: "one\ntwo\n" } },
      ] } })
      + line({ type: "message", id: "r1", parentId: "a3", timestamp: at, message: { role: "toolResult", toolCallId: "edit-1", toolName: "edit", content: [{ type: "text", text: "ok" }], details: { patch } } })
      + line({ type: "message", id: "r2", parentId: "r1", timestamp: at, message: { role: "toolResult", toolCallId: "write-1", toolName: "write", content: [{ type: "text", text: "ok" }], details: { operation: "add", patch: `--- /dev/null\n+++ ${outside}\n@@ -0,0 +1,2 @@\n+one\n+two\n` } } })
      + message("a4", "r2", "assistant", "Edited two files"));
    const card = page.getByTestId("edited-files").last();
    await expect(card.locator('li[data-path="src/app.ts"]')).toContainText("+1 -1");
    // Outside the session cwd the path stays absolute.
    await expect(card.locator("li").filter({ hasText: outside })).toContainText("+2 -0");
    await card.getByTestId("edited-files-view").click();
    const turn = page.getByTestId("workspace-session-turn").filter({ hasText: "Edit files from the terminal" });
    await expect(turn).toHaveAttribute("data-focused", "true");
    await expect(page.getByTestId("workspace-session-git")).toHaveCount(0);
    const changed = turn.locator('[data-testid="workspace-session-file"][data-path="src/app.ts"]');
    await changed.locator("summary").click();
    await expect(changed).toContainText("new line");
    await expect(changed).toContainText("old line");
    await shot(page, "session-sync-changes");

    // Agents the terminal's omo runs for this session follow its task store live instead of a restored snapshot.
    const tasks = path.join(pickDir, ".omo", "senpi-task", "tasks");
    mkdirSync(tasks, { recursive: true });
    const record = (status: string) => JSON.stringify({ task_id: "st_terminal", parent_session_id: THREAD, root_session_id: THREAD, status,
      execution_mode: "in-process", model: "fake/model", depth: 1, created_at: at, updated_at: new Date().toISOString(),
      task_summary: "Agent started in the terminal", name: "terminal-agent", residency_state: status === "running" ? "resident" : "persisted_only" });
    writeFileSync(path.join(tasks, "st_terminal.json"), record("running"));
    await page.getByTestId("right-tab-work").click();
    await page.getByTestId("workflow-list").click();
    const activity = byTestId(page, TESTID.omoActivity);
    await expect(activity).toHaveAttribute("data-freshness", "live");
    const row = activity.locator('[data-task-id="st_terminal"]');
    await expect(row).toHaveAttribute("data-status", "running");
    writeFileSync(path.join(tasks, "st_terminal.json"), record("completed"));
    await expect(row).toHaveAttribute("data-status", "completed");
    await page.getByTestId("workflow-graph-view").click();
    await expect(page.getByTestId("agent-graph-node").filter({ hasText: "Agent started in the terminal" })).toHaveAttribute("data-state", "completed");
    await shot(page, "session-sync-live-agents");
  } finally {
    await launched.close();
    for (const target of [fakeHome, pickDir]) quarantineSync(target, { recursive: true, force: true });
  }
});

test("a completed child's final change is reread after an in-flight transcript read", async () => {
  const home = tempDir("child-refresh-home"), cwd = tempDir("child-refresh-project");
  const sessions = path.join(home, "sessions"), store = path.join(cwd, ".omo", "senpi-task");
  const child = path.join(store, "children", "st_done", "sessions", "now_child.jsonl");
  mkdirSync(sessions, { recursive: true });
  mkdirSync(path.dirname(child), { recursive: true });
  mkdirSync(path.join(store, "tasks"), { recursive: true });
  writeFileSync(path.join(sessions, `${THREAD}.jsonl`), line({ type: "session", version: 3, id: THREAD, cwd })
    + message("u", null, "user", "Main question") + message("a", "u", "assistant", "Main answer"));
  writeFileSync(child, line({ type: "session", version: 3, id: "child" }) + message("old", null, "assistant", "Before final child change"));
  writeFileSync(path.join(store, "tasks", "st_done.json"), JSON.stringify({ task_id: "st_done", parent_session_id: THREAD,
    child_session_id: "child", status: "completed", execution_mode: "in-process", model: "fake/model", residency_state: "persisted_only", depth: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
  const launched = await launchApp({ omo: "fake", fakeHome: home, pickDir: cwd, managed: [THREAD] });
  try {
    const { page, app } = launched;
    await threadRow(page, THREAD).getByRole("button").first().click();
    await page.getByTestId("right-tab-work").click();
    await page.getByTestId("workflow-agents-view").click();
    const transcript = page.getByTestId("agent-chat-history");
    await expect(transcript).toContainText("Before final child change");
    await page.clock.pauseAt(new Date());
    await app.evaluate(({ ipcMain, BrowserWindow }, id) => {
      const web = BrowserWindow.getAllWindows()[0]!.webContents;
      const send = web.send.bind(web);
      web.send = (channel, ...args) => { if (channel !== "history:task-work-changed") send(channel, ...args); };
      const channel = "history:task-work", existing = Reflect.get(ipcMain, "_invokeHandlers").get(channel);
      let captured = false;
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (event, cwd: string, parent: string, task?: string) => {
        const value = await existing(event, cwd, parent, task);
        if (!captured && task === "st_done") {
          captured = true;
          let release = (): void => {};
          const pending = new Promise<void>(resolve => { release = resolve; });
          Object.assign(globalThis, { releaseChildRead: release });
          await web.executeJavaScript('document.documentElement.dataset.qaChildReadHeld = "true"');
          await pending;
        }
        return value;
      });
      web.send("omo:notification", { method: "extension_event", params: { threadId: id, name: "qa-refresh" } });
    }, THREAD);
    await expect(page.locator("html")).toHaveAttribute("data-qa-child-read-held", "true");
    appendFileSync(child, message("final", "old", "assistant", "Final child change during read"));
    await page.evaluate(() => Object.assign(window, { qaChildChanged: new Promise<void>(resolve => {
      const off = window.omo.onNotification(notification => {
        const params = notification.params;
        if (notification.method === "extension_event" && typeof params === "object" && params !== null && "name" in params && params.name === "qa-last-change") { off(); resolve(); }
      });
    }) }));
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0]?.webContents.send("omo:notification", {
      method: "extension_event", params: { threadId: id, name: "qa-last-change" },
    }), THREAD);
    await page.evaluate(() => Reflect.get(window, "qaChildChanged"));
    await app.evaluate(() => Reflect.get(globalThis, "releaseChildRead")());
    await expect(transcript).toContainText("Final child change during read");
  } finally {
    await launched.close();
    for (const target of [home, cwd]) quarantineSync(target, { recursive: true, force: true });
  }
});
