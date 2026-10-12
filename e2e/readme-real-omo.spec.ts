import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TESTID } from "../src/ui/testids.ts";
import { newSession } from "./helpers.ts";

// Captures docs/media/real-omo.png: the installed OmO UI Windows on the user's real omo answering a question about a
// throwaway sample project. Fresh app user data; omo's own configuration and credentials are used as installed.
test.skip(process.env["OMO_UI_README_REAL"] !== "1", "set OMO_UI_README_REAL=1");
test.setTimeout(10 * 60_000);

const EXE = path.join(process.env["LOCALAPPDATA"] ?? "", "Programs", "OmO UI Windows", "OmO UI Windows.exe");
const MODEL = process.env["OMO_UI_README_MODEL"] ?? "opencodex/opencode-go/deepseek-v4.1-flash";
const OUT = path.resolve(import.meta.dirname, "..", "docs", "media", "real-omo.png");

test("README real-omo capture", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "omo-ui-readme-real-"));
  const project = path.join(root, "acme-shop");
  mkdirSync(path.join(project, "src", "lib"), { recursive: true });
  writeFileSync(path.join(project, "src", "lib", "cart.ts"), [
    "export interface CartItem { sku: string; price: number; quantity: number }",
    "export interface Totals { subtotal: number; tax: number; total: number }",
    "export const TAX_RATE = 0.08;",
    "",
    "export function cartTotals(items: CartItem[]): Totals {",
    "  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);",
    "  const tax = Math.round(subtotal * TAX_RATE);",
    "  return { subtotal, tax, total: subtotal + tax };",
    "}",
    "",
  ].join("\n"));
  const userData = path.join(root, "user-data");
  mkdirSync(userData);
  writeFileSync(path.join(userData, "preferences.json"), JSON.stringify({ locale: "en", theme: "dark", onboardingCompleted: true }));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  for (const key of ["ELECTRON_RUN_AS_NODE", "OMO_UI_OMO_BIN", "FAKE_OMO_HOME", "FAKE_OMO_LOG"]) delete env[key];
  Object.assign(env, { OMO_UI_USER_DATA: userData, OMO_UI_QA_PICK_DIR: project, OMO_UI_OMO_AUTO_UPDATE: "0", OMO_UI_IPHONE_BRIDGE: "0" });
  const app = await electron.launch({ executablePath: EXE, args: [], env, timeout: 90_000 });
  try {
    const page = await app.firstWindow({ timeout: 90_000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 1000));
    await expect(page.locator("html")).toHaveAttribute("data-bridge-state", "connected", { timeout: 120_000 });
    await newSession(page);
    await page.getByTestId(TESTID.modelPicker).click();
    await page.getByTestId(TESTID.specificModelTab).click();
    await page.locator(`[data-testid="${TESTID.modelOption}"][data-model-id="${MODEL}"]`).first().click();
    await page.keyboard.press("Escape");
    const input = page.getByTestId(TESTID.composerInput);
    await input.click();
    await page.keyboard.insertText("Answer in English. Read src/lib/cart.ts and explain how cart totals are computed: one short paragraph and a small table. No status summary or report block, and no currency symbols.");
    await input.press("Enter");
    await expect(page.getByTestId(TESTID.assistantMessage).last()).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId(TESTID.composerStop)).toHaveCount(0, { timeout: 240_000 });
    const threadId = await page.locator('[data-testid="thread-row"][aria-current="page"]').getAttribute("data-thread-id");
    if (threadId === null) throw new Error("no active session row");
    await page.evaluate((id) => window.omo.request("thread/name/set", { threadId: id, name: "How are cart totals computed?" }), threadId);
    await page.keyboard.press("Control+\\");
    await page.waitForTimeout(800);
    // The natural resting state: scrolled to the latest answer, so no "Jump to latest" button covers it.
    await page.keyboard.press("End");
    await page.screenshot({ path: OUT });
  } finally {
    await app.close();
  }
});
