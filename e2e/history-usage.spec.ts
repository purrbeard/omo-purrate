import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { byTestId, contrastRatio, launchApp, newSession, send, setTheme, shot, threadRow } from "./helpers.ts";
import { TESTID } from "../src/ui/testids.ts";

const nativeUsage = { input: 2, output: 932, cacheRead: 16945, cacheWrite: 34201, totalTokens: 52080 };

test("historical native counters preserve zero and missing values in the answer and session popup", async () => {
  const home = test.info().outputPath("home");
  const workspace = test.info().outputPath("workspace");
  mkdirSync(path.join(home, "sessions"), { recursive: true });
  mkdirSync(workspace, { recursive: true });
  const timestamp = "2026-11-01T09:00:00Z";
  const rows: object[] = [{ type: "session", version: 3, id: "usage-history", cwd: workspace, timestamp }];
  let parentId: string | null = null;
  for (const [index, usage] of [nativeUsage, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, { input: 2, cacheRead: 20 }, undefined].entries()) {
    const user = `u-${index}`;
    const answer = `a-${index}`;
    rows.push({ type: "message", id: user, parentId, timestamp, message: { role: "user", content: [{ type: "text", text: `Usage fixture ${index + 1}` }] } });
    rows.push({ type: "message", id: answer, parentId: user, timestamp, message: { role: "assistant", provider: "fake", model: "alpha", stopReason: "stop", content: [{ type: "text", text: `기록된 답변 ${index + 1}: 네이티브 토큰 사용량을 확인합니다.` }], ...(usage === undefined ? {} : { usage }) } });
    parentId = answer;
  }
  writeFileSync(path.join(home, "sessions", "usage-history.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  const launched = await launchApp({ omo: "fake", fakeHome: home, pickDir: workspace, managed: ["usage-history"], size: { width: 1440, height: 900 } });
  try {
    const { page, app } = launched;
    await threadRow(page, "usage-history").getByRole("button").first().click();
    await expect(page.getByTestId("answer-footer")).toHaveCount(4);
    await shot(page, "usage-history-initial");
    const turns = byTestId(page, TESTID.turn);
    const first = turns.nth(0).getByTestId("turn-usage");
    await expect(first).toHaveAttribute("data-input", "2");
    await expect(first).toHaveAttribute("data-output", "932");
    await expect(first).toHaveAttribute("data-cache-read", "16945");
    await expect(first).toHaveAttribute("data-cache-write", "34201");
    await expect(first).toHaveAttribute("data-total-tokens", "52080");
    expect(Number(await first.getAttribute("data-cache-hit"))).toBeCloseTo(16945 / (2 + 16945 + 34201) * 100, 5);
    const zero = turns.nth(1).getByTestId("turn-usage");
    await expect(zero).toHaveAttribute("data-total-tokens", "0");
    await expect(zero.getByTestId("turn-usage-total")).toHaveText("Total 0");
    const partial = turns.nth(2).getByTestId("turn-usage");
    await expect(partial.getByTestId("turn-usage-output")).toHaveText("Output -");
    await expect(partial.getByTestId("turn-usage-cache")).toHaveText("Cache hit -");
    await expect(turns.nth(3).getByTestId("turn-usage-total")).toHaveText("Total -");
    const gauge = page.getByTestId("context-gauge");
    await expect(gauge).toBeVisible();
    await gauge.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(gauge).toBeFocused();
    const popup = page.getByTestId("context-usage-detail");
    await expect(popup).toBeVisible();
    await expect(popup.getByTestId("context-session-composition")).toBeVisible();
    await expect(popup.locator("[data-component]")).toHaveCount(4);
    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
    const metrics: object[] = [];
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await page.evaluate(() => window.omo.setPreferences({ locale: "ko" }));
      for (const width of [1440, 640]) {
        await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]?.setContentSize(width, 900), width);
        await expect(page.locator("html")).toHaveJSProperty("clientWidth", width);
        await first.scrollIntoViewIfNeeded();
        await first.focus();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        await expect(page.getByTestId("turn-usage-detail")).toBeVisible();
        await shot(page, `usage-turn-${theme}-${width}`);
        await page.keyboard.press("Escape");
        await gauge.focus();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        await expect(popup).toBeVisible();
        await shot(page, `usage-session-${theme}-${width}`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        const colors = await popup.evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
        const contrast = contrastRatio(colors.color, colors.background);
        expect(contrast).toBeGreaterThanOrEqual(4.5);
        metrics.push({ theme, width, contrast, surface: await page.evaluate(() => ({
          window: { width: innerWidth, height: innerHeight },
          scrollers: [...document.querySelectorAll("*")].filter(element => /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight).map(element => ({ testId: element.getAttribute("data-testid"), className: element.className })),
          focus: { testId: document.activeElement?.getAttribute("data-testid"), visible: document.activeElement?.matches(":focus-visible") },
        })) });
        await page.keyboard.press("Escape");
      }
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
    }
    writeFileSync(test.info().outputPath("ui-metrics.json"), JSON.stringify(metrics, null, 2));
    await test.info().attach("ui-metrics", { path: test.info().outputPath("ui-metrics.json"), contentType: "application/json" });
  } finally { await launched.close(); }
});

test("live answer usage stays hidden until the native turn completes", async () => {
  const workspace = test.info().outputPath("workspace");
  mkdirSync(workspace, { recursive: true });
  const demo = test.info().outputPath("demo.json");
  writeFileSync(demo, JSON.stringify({ scenes: [{ match: "SCENARIO:usage-held", steps: [
    { item: { type: "agentMessage", text: "Completed message in a still running turn" }, ms: 0 }, { hold: true },
  ] }] }));
  const launched = await launchApp({ omo: "fake", pickDir: workspace, extraEnv: { FAKE_OMO_DEMO: demo } });
  try {
    const { page } = launched;
    const id = await newSession(page);
    await send(page, "SCENARIO:usage-held");
    await expect(page.getByText("Completed message in a still running turn")).toBeVisible();
    await expect(page.getByTestId("turn-usage")).toHaveCount(0);
    await shot(page, "usage-live-streaming");
    await page.evaluate(async threadId => { await window.omo.request("extension_request", { threadId, name: "fake.advance", data: {} }); }, id);
    await expect(byTestId(page, TESTID.turn).last()).toHaveAttribute("data-status", "completed");
    await expect(page.getByTestId("turn-usage")).toHaveAttribute("data-total-tokens", "0");
    await shot(page, "usage-live-completed");
  } finally { await launched.close(); }
});
