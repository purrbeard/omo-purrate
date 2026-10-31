import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, lastTurn, launchApp, newSession, send, shot, tempDir } from "./helpers.ts";

// No other spec covers the conversation header menu, so the session export lives here.
test("Export session writes omo's HTML and says where it went", async () => {
  const pickDir = tempDir("export-workspace");
  const target = path.join(tempDir("export-target"), "session.html");
  const launched = await launchApp({ omo: "fake", pickDir, extraEnv: { OMO_UI_QA_SAVE_PATH: target } });
  try {
    const { page } = launched;
    await newSession(page);
    await send(page, "export me");
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");

    await byTestId(page, TESTID.headerMenu).click();
    await shot(page, "header-menu");
    await byTestId(page, TESTID.headerExport).click();
    await expect(byTestId(page, TESTID.noticeToast)).toContainText(target);

    const html = readFileSync(target, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("export me");
    expect(html).toContain("echo: export me");
  } finally { await launched.close(); }
});

test("Native JSONL export imports as an independent copy with its conversation", async () => {
  const pickDir = tempDir("jsonl-workspace");
  const target = path.join(tempDir("jsonl-target"), "session.jsonl");
  const launched = await launchApp({ omo: "fake", pickDir, extraEnv: { OMO_UI_QA_SAVE_PATH: target, OMO_UI_QA_PICK_ATTACHMENTS: JSON.stringify([target]) } });
  try {
    const { page } = launched;
    await newSession(page);
    await send(page, "roundtrip-jsonl-731");
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
    const sourceId = await byTestId(page, TESTID.composerInput).getAttribute("data-thread-id");
    await byTestId(page, TESTID.headerMenu).click();
    await page.getByTestId("header-export-jsonl").click();
    await expect(byTestId(page, TESTID.noticeToast)).toContainText(target);
    const original = readFileSync(target, "utf8");
    await byTestId(page, TESTID.openSettings).click();
    await page.locator('[data-section="import"]').click();
    await page.getByTestId("settings-import-jsonl").click();
    await expect(page.getByTestId("settings-import-done")).toBeVisible();
    const preferences = await page.evaluate(() => window.omo.getPreferences());
    const copiedId = preferences.managedThreadIds.find(id => id !== sourceId);
    expect(copiedId).toBeDefined();
    if (copiedId === undefined) throw new Error("Imported copy has no identity");
    const { thread } = await page.evaluate(id => window.omo.request("thread/read", { threadId: id, includeTurns: true }), copiedId);
    expect(thread.path).not.toBe(target);
    if (thread.path === null) throw new Error("Imported copy has no file");
    const imported = readFileSync(thread.path, "utf8");
    expect(imported.slice(imported.indexOf("\n") + 1)).toBe(original.slice(original.indexOf("\n") + 1));
    expect(readFileSync(target, "utf8")).toBe(original);
    await shot(page, "jsonl-import-done");
  } finally { await launched.close(); }
});

test("Malformed JSONL import reports an error without registering a session", async () => {
  const target = path.join(tempDir("jsonl-invalid"), "bad.jsonl");
  writeFileSync(target, "{bad-json\n");
  const launched = await launchApp({ omo: "fake", extraEnv: { OMO_UI_QA_PICK_ATTACHMENTS: JSON.stringify([target]) } });
  try {
    const { page } = launched;
    const before = await page.evaluate(() => window.omo.getPreferences());
    await byTestId(page, TESTID.openSettings).click();
    await page.locator('[data-section="import"]').click();
    await page.getByTestId("settings-import-jsonl").click();
    await expect(page.getByTestId("settings-import").getByRole("alert")).toBeVisible();
    expect((await page.evaluate(() => window.omo.getPreferences())).managedThreadIds).toEqual(before.managedThreadIds);
    expect(readFileSync(target, "utf8")).toBe("{bad-json\n");
  } finally { await launched.close(); }
});
