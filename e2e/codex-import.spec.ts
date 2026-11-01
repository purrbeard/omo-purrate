import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, shot } from "./helpers.ts";

function rollout(file: string, cwd: string): string {
  const timestamp = "2026-11-01T09:00:00.000Z";
  const rows = [
    { timestamp, type: "session_meta", payload: { id: "codex-source", cwd, model_provider: "openai" } },
    { timestamp, type: "turn_context", payload: { model: "gpt-source" } },
    { timestamp, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Imported question" }] } },
    { timestamp, type: "response_item", payload: { type: "reasoning", encrypted_content: "opaque-test-data", summary: [] } },
    { timestamp, type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Imported answer" }] } },
  ];
  const text = rows.map(row => JSON.stringify(row)).join("\n") + "\n";
  writeFileSync(file, text);
  return text;
}

test("Codex preview explains losses before importing an independent native conversation", async () => {
  const workspace = test.info().outputPath("workspace");
  mkdirSync(workspace, { recursive: true });
  const source = test.info().outputPath("rollout.jsonl");
  const original = rollout(source, workspace);
  const launched = await launchApp({ omo: "fake", pickDir: workspace, extraEnv: { OMO_UI_QA_PICK_ATTACHMENTS: JSON.stringify([source]) } });
  try {
    const { page } = launched;
    await byTestId(page, TESTID.openSettings).click();
    await page.locator('[data-section="import"]').click();
    await page.getByTestId("codex-import-pick").click();
    const preview = page.getByTestId("codex-import-preview");
    await expect(preview).toBeVisible();
    await expect(preview.locator('[data-reason="encrypted_reasoning"]')).toHaveAttribute("data-count", "1");
    await expect(page.getByTestId("codex-import-done")).toHaveCount(0);
    const before = await page.evaluate(() => window.omo.getPreferences());
    await page.getByTestId("codex-import-cwd").fill(workspace);
    await page.getByTestId("codex-import-model").selectOption({ index: 1 });
    await shot(page, "codex-preview");
    await page.getByTestId("codex-import-confirm").click();
    await expect(page.getByTestId("codex-import-done")).toBeVisible();
    const after = await page.evaluate(() => window.omo.getPreferences());
    const id = after.managedThreadIds.find(value => !before.managedThreadIds.includes(value));
    if (id === undefined) throw new Error("No imported native session registered");
    const history = await page.evaluate(threadId => window.omo.request("thread/read", { threadId, includeTurns: true }), id);
    expect(history.thread.path).not.toBe(source);
    if (history.thread.path === null) throw new Error("Imported native file missing");
    const copy = readFileSync(history.thread.path, "utf8");
    expect(copy).toContain("Imported question");
    expect(copy).toContain("Imported answer");
    expect(copy).not.toContain("opaque-test-data");
    expect(readFileSync(source, "utf8")).toBe(original);
    await shot(page, "codex-import-done");
  } finally { await launched.close(); }
});

test("Codex import refuses a source changed since preview without registering a partial session", async () => {
  const workspace = test.info().outputPath("workspace");
  mkdirSync(workspace, { recursive: true });
  const source = test.info().outputPath("rollout.jsonl");
  rollout(source, workspace);
  const launched = await launchApp({ omo: "fake", pickDir: workspace, extraEnv: { OMO_UI_QA_PICK_ATTACHMENTS: JSON.stringify([source]) } });
  try {
    const { page } = launched;
    await byTestId(page, TESTID.openSettings).click();
    await page.locator('[data-section="import"]').click();
    await page.getByTestId("codex-import-pick").click();
    await expect(page.getByTestId("codex-import-preview")).toBeVisible();
    await page.getByTestId("codex-import-cwd").fill(workspace);
    await page.getByTestId("codex-import-model").selectOption({ index: 1 });
    const before = await page.evaluate(() => window.omo.getPreferences());
    appendFileSync(source, JSON.stringify({ timestamp: "2026-11-01T09:01:00Z", type: "event_msg", payload: { type: "task_complete" } }) + "\n");
    await page.getByTestId("codex-import-confirm").click();
    await expect(page.getByTestId("codex-import-error")).toBeVisible();
    expect((await page.evaluate(() => window.omo.getPreferences())).managedThreadIds).toEqual(before.managedThreadIds);
    await expect(page.getByTestId("codex-import-done")).toHaveCount(0);
    await shot(page, "codex-source-changed");
  } finally { await launched.close(); }
});
