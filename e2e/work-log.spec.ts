import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, lastTurn, launchApp, newSession, send, setTheme, shot, threadRow } from "./helpers.ts";

test("native same-parent tasks have one turn owner and settled answers copy their recorded text", async () => {
  const workspace = test.info().outputPath("workspace");
  mkdirSync(workspace, { recursive: true });
  const demo = test.info().outputPath("demo.json");
  const text = "Recorded final answer";
  writeFileSync(demo, JSON.stringify({ scenes: [{ match: "SCENARIO:turn-roster", steps: [
    { item: { type: "dynamicToolCall", tool: "read", namespace: null, arguments: { path: "src/example.ts" }, status: "completed", success: true, contentItems: null, durationMs: 12 }, ms: 0 },
    { tasks: [
      { task_id: "native-running", task_summary: "긴 한국어 제목으로 대화 턴 서브에이전트 목록의 줄바꿈 확인", status: "running", model: "fake/alpha", category: "deep-low" },
      { task_id: "native-error", task_summary: "Inspect error state", status: "error", model: "fake/alpha", error_message: "Fixture error" },
      { task_id: "unknown-clock", task_summary: "No recorded creation", status: "running", model: "fake/alpha", created_at: "" },
    ] },
    { item: { type: "agentMessage", text, phase: "final_answer" }, ms: 0 },
    { hold: true },
  ] }] }));
  const launched = await launchApp({ omo: "fake", pickDir: workspace, extraEnv: { FAKE_OMO_DEMO: demo } });
  try {
    const { page, app } = launched;
    const id = await newSession(page);
    const roster = page.getByTestId("turn-subagents");
    const arrived = expect(roster).toBeVisible();
    await send(page, "SCENARIO:turn-roster");
    await arrived;
    await expect(roster.locator("li")).toHaveCount(2);
    await expect(roster.locator('[data-task-id="native-running"]')).toHaveAttribute("data-status", "running");
    await expect(roster.locator('[data-task-id="native-error"]')).toHaveAttribute("data-status", "error");
    await expect(page.getByTestId("answer-footer")).toHaveCount(0);
    const first = byTestId(page, TESTID.turn).first();
    const completed = expect(first).toHaveAttribute("data-status", "completed");
    await page.evaluate(async threadId => {
      await window.omo.request("extension_request", { threadId, name: "fake.advance", data: {} });
    }, id);
    await completed;
    await expect(roster).toBeVisible();
    await expect(roster.locator("li")).toHaveCount(2);
    const footer = first.getByTestId("answer-footer");
    const clock = footer.getByTestId("answer-completed-at");
    await expect(clock).toHaveAttribute("datetime", /T/);
    const recorded = await clock.getAttribute("datetime");
    await footer.getByRole("button", { name: "Copy answer", exact: true }).click();
    await expect(footer.getByRole("status")).toHaveText("Copied");
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(text);
    await first.getByTestId("turn-work-log").locator("summary").click();
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await shot(page, `turn-subagents-${theme}-desktop`);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(640, 760));
      await expect(page.locator("html")).toHaveJSProperty("clientWidth", 640);
      await shot(page, `turn-subagents-${theme}-narrow`);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 820));
    }
    await first.getByTestId("turn-work-log").locator("summary").click();
    const secondDone = expect(byTestId(page, TESTID.turn)).toHaveCount(2);
    await send(page, "Follow up in this session");
    await secondDone;
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
    await expect(lastTurn(page).getByTestId("turn-subagents")).toHaveCount(0);
    expect(recorded).not.toBeNull();
    await expect(clock).toHaveAttribute("datetime", recorded ?? "");
    expect(await page.locator('[data-testid="turn-subagents"] [data-task-id="native-running"]').count()).toBeLessThanOrEqual(1);
    await first.getByTestId("turn-work-log").locator("summary").click();
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await shot(page, `turn-work-log-${theme}-desktop`);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(640, 760));
      await expect(page.locator("html")).toHaveJSProperty("clientWidth", 640);
      await shot(page, `turn-work-log-${theme}-narrow`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 820));
    }
    expect(launched.readFakeLog().filter(entry => entry["method"] === "thread/start")).toHaveLength(1);
  } finally { await launched.close(); }
});

test("interactive requests stay visible while native work is folded", async () => {
  const workspace = test.info().outputPath("workspace");
  mkdirSync(workspace, { recursive: true });
  const launched = await launchApp({ omo: "fake", pickDir: workspace });
  try {
    const { page } = launched;
    await newSession(page);
    const approval = byTestId(page, TESTID.approvalCard);
    const arrived = expect(approval).toBeVisible();
    await send(page, "SCENARIO:full");
    await arrived;
    const log = page.getByTestId("turn-work-log");
    await expect(log).not.toHaveAttribute("open", "");
    await expect(approval).toBeVisible();
    await approval.getByRole("button", { name: "Allow once", exact: true }).click();
    await expect(byTestId(page, TESTID.questionCard)).toBeVisible();
    await expect(log).not.toHaveAttribute("open", "");
    expect(await byTestId(page, TESTID.questionCard).evaluate(element => element.closest('[data-testid="turn-work-log"]'))).toBeNull();
  } finally { await launched.close(); }
});

test("restored memory receipts stay outside the fold and unknown answer clocks remain omitted", async () => {
  const fakeHome = test.info().outputPath("home");
  const workspace = test.info().outputPath("workspace");
  mkdirSync(path.join(fakeHome, "sessions"), { recursive: true });
  mkdirSync(workspace, { recursive: true });
  const timestamp = "2026-10-07T09:00:00Z";
  const lines = [
    { type: "session", version: 3, id: "memory-turn", timestamp, cwd: workspace },
    { type: "message", id: "u", parentId: null, message: { role: "user", content: [{ type: "text", text: "Remember fixture" }] } },
    { type: "message", id: "a", parentId: "u", message: { role: "assistant", content: [
      { type: "thinking", thinking: "Native recorded reasoning" },
      { type: "toolCall", id: "memory-call", name: "memory", arguments: { command: "create", file_path: "notes/fixture.md" } },
    ] } },
    { type: "message", id: "r", parentId: "a", message: { role: "toolResult", toolCallId: "memory-call", toolName: "memory",
      content: [{ type: "text", text: "Recorded" }], details: { writeNotice: { sha: "abc1234", subject: "Fixture", affected: [], size: null } } } },
    { type: "message", id: "final", parentId: "r", message: { role: "assistant", content: [{ type: "text", text: "Saved fixture" }], stopReason: "stop" } },
  ];
  writeFileSync(path.join(fakeHome, "sessions", "memory-turn.jsonl"), lines.map(line => JSON.stringify(line)).join("\n") + "\n");
  const launched = await launchApp({ omo: "fake", fakeHome, pickDir: workspace, managed: ["memory-turn"] });
  try {
    const { page } = launched;
    await threadRow(page, "memory-turn").getByRole("button").first().click();
    const log = page.getByTestId("turn-work-log");
    await expect(log).not.toHaveAttribute("open", "");
    const receipt = byTestId(page, TESTID.memoryWrite);
    await expect(receipt).toBeVisible();
    expect(await receipt.evaluate(element => element.closest('[data-testid="turn-work-log"]'))).toBeNull();
    await expect(page.getByTestId("answer-footer")).toBeVisible();
    await expect(page.getByTestId("answer-completed-at")).toHaveCount(0);
    await log.locator(":scope > summary").click();
    await expect(byTestId(page, TESTID.reasoning)).toBeVisible();
  } finally { await launched.close(); }
});
