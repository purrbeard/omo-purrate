import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { processStartTimes } from "../electron/omo/session-holders.ts";
import { launchApp, shot, threadRow } from "./helpers.ts";

test("foreign ownership is read-only and becomes writable when its process exits without removing the lease", async () => {
  const root = test.info().outputPath("owned-fixture");
  const home = path.join(root, "agent"), userData = path.join(root, "ui"), workspace = path.join(root, "workspace");
  for (const directory of [home, userData, workspace]) mkdirSync(directory, { recursive: true });
  const child = spawn(process.execPath, ["-e", "process.stdout.write('READY\\n');process.stdin.resume();process.stdin.once('data',()=>process.exit(0));"], { windowsHide: true, stdio: "pipe" });
  const ready = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.stdout.once("data", chunk => String(chunk).trim() === "READY" ? resolve() : reject(new Error("unexpected owner greeting")));
  });
  const exited = new Promise<void>((resolve, reject) => child.once("exit", code => code === 0 ? resolve() : reject(new Error(`owner fixture exited ${code}`))));
  let running: Awaited<ReturnType<typeof launchApp>> | null = null;
  try {
    await ready;
    const pid = child.pid;
    if (pid === undefined) throw new Error("owner fixture has no pid");
    const started = (await processStartTimes([pid])).get(pid)?.startedAtMs;
    if (started === undefined) throw new Error("owner fixture identity unavailable");
    const id = "0190f0c0-0000-7000-8000-00000000ccc1";
    const sessions = path.join(home, "sessions");
    const leases = path.join(sessions, "session-holders", id);
    mkdirSync(leases, { recursive: true });
    const lease = path.join(leases, `${pid}.json`);
    const record = JSON.stringify({ pid, bootAtMs: 1, processStartedAtMs: started, cwd: workspace });
    writeFileSync(lease, record);
    const file = path.join(sessions, `${id}.jsonl`);
    const original = [
      { type: "session", version: 3, id, timestamp: "2026-10-31T17:00:00.000Z", cwd: workspace },
      { type: "message", id: "user-first", parentId: null, timestamp: "2026-10-31T17:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "Preserve this foreign conversation" }] } },
      { type: "message", id: "answer-first", parentId: "user-first", timestamp: "2026-10-31T17:00:01.000Z", message: { role: "assistant", content: [{ type: "text", text: "Original foreign answer" }], stopReason: "stop" } },
    ].map(entry => JSON.stringify(entry)).join("\n") + "\n";
    writeFileSync(file, original);
    running = await launchApp({ omo: "fake", fakeHome: home, userData, pickDir: workspace, managed: [id], extraEnv: { OMO_UI_ALPHA_HOME: "" } });
    const { page } = running;
    await threadRow(page, id).click();
    await expect(page.getByText("Original foreign answer", { exact: true })).toBeVisible();
    const input = page.getByTestId("composer-input"), banner = page.getByTestId("composer-held-banner");
    await expect(banner).toContainText(`pid ${pid}`);
    await expect(input).toBeDisabled();
    const refusal = await page.evaluate(async id => {
      try { await window.omo.request("turn/start", { threadId: id, input: [{ type: "text", text: "MUST_NOT_WRITE", text_elements: [] }] }); return "unexpected success"; }
      catch (error) { return error instanceof Error ? error.message : String(error); }
    }, id);
    expect(refusal).toContain("session_held:");
    expect(readFileSync(file, "utf8")).toBe(original);
    await shot(page, "ownership-foreign-readonly");
    appendFileSync(file, JSON.stringify({ type: "message", id: "outside-update", parentId: "answer-first", message: { role: "assistant", content: "Foreign owner continued", stopReason: "stop" } }) + "\n");
    await expect(page.getByText("Foreign owner continued", { exact: true })).toBeVisible();
    await expect(banner).toContainText(`pid ${pid}`);
    await expect(input).toBeDisabled();
    child.stdin.write("release\n");
    await exited;
    await expect(banner).toHaveCount(0);
    await expect(input).toBeEnabled();
    expect(readFileSync(lease, "utf8")).toBe(record);
    expect(readFileSync(file, "utf8").startsWith(original)).toBe(true);
    expect(running.readFakeLog().some(entry => entry["type"] === "prompt")).toBe(false);
    await shot(page, "ownership-auto-writable");
  } finally {
    child.stdin.end();
    await running?.close();
    await exited;
  }
});
