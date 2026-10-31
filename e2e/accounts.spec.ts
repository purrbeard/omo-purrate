import { mkdirSync, writeFileSync } from "node:fs";
import { quarantineSync } from "../scripts/quarantine-temp.mjs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, shot, tempDir } from "./helpers.ts";

test("Accounts lists omo's accounts with their quota state, and pins and removes through omo", async () => {
  const fakeHome = tempDir("accounts-home");
  mkdirSync(fakeHome, { recursive: true });
  // Expired tokens keep the quota reader off the network: each row reports "expired" without a request.
  writeFileSync(path.join(fakeHome, "auth.json"), JSON.stringify({
    "anthropic-subscription": { accounts: [{ name: "work", access: "x", expires: 1 }, { name: "old", access: "y", expires: 1 }] },
    "chatgpt-subscription": { accounts: [{ name: "plus", access: "z", expires: 1 }] },
  }));
  const launched = await launchApp({ omo: "fake", fakeHome });
  try {
    const { page, readFakeLog } = launched;
    await byTestId(page, TESTID.openSettings).click();
    await page.locator('[data-section="accounts"]').click();
    const claude = page.locator(`[data-testid="${TESTID.accountProvider}"][data-provider="anthropic-subscription"]`);
    const chatgpt = page.locator(`[data-testid="${TESTID.accountProvider}"][data-provider="chatgpt-subscription"]`);
    const row = (scope: typeof claude, name: string) => scope.locator(`[data-testid="${TESTID.accountRow}"][data-account="${name}"]`);

    await expect(row(claude, "work")).toHaveAttribute("data-status", "expired");
    await expect(row(claude, "work")).toContainText("Expired");
    await expect(claude).toContainText("Expired tokens renew");
    await expect(row(claude, "old")).toHaveAttribute("data-status", "blocked");
    await expect(row(claude, "old")).toContainText("Needs sign-in");
    await expect(row(chatgpt, "plus")).toHaveAttribute("data-status", "expired");
    await expect(claude.getByTestId(TESTID.accountSignIn)).toHaveText("Add account");
    await shot(page, "accounts");

    await row(claude, "work").getByTestId(TESTID.accountPin).click();
    await expect(row(claude, "work")).toHaveAttribute("data-status", "pinned");
    await row(claude, "old").getByTestId(TESTID.accountRemove).click();
    await row(claude, "old").getByTestId(TESTID.accountRemoveConfirm).click();
    await expect(row(claude, "old")).toHaveCount(0);
    const calls = (await readFakeLog()).filter((entry) => entry["type"] === "account_pin" || entry["type"] === "account_remove");
    expect(calls.map((entry) => [entry["type"], { provider: entry["provider"], name: entry["name"] }])).toEqual([
      ["account_pin", { provider: "anthropic-subscription", name: "work" }],
      ["account_remove", { provider: "anthropic-subscription", name: "old" }],
    ]);
    await shot(page, "accounts-after");
  } finally {
    await launched.close();
    quarantineSync(fakeHome, { recursive: true, force: true });
  }
});

test("Accounts keeps the newest refresh when an older focus request finishes last", async () => {
  const launched = await launchApp({ omo: "fake" });
  try {
    const { app, page } = launched;
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      const pending: Array<() => void> = [];
      Object.assign(globalThis, { releaseAccountRead: (index: number) => pending[index]?.() });
      ipcMain.removeHandler("omo:request");
      ipcMain.handle("omo:request", async (_event, method: string, params: { provider?: string }) => {
        if (method !== "account/providerAccounts/read") throw new Error(`unexpected request ${method}`);
        if (params.provider !== "anthropic-subscription") return { ok: true, result: { provider: params.provider, accounts: [] } };
        const index = pending.length;
        const gate = new Promise<void>(resolve => pending.push(resolve));
        await BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript(`document.documentElement.dataset.qaAccountRequests = "${pending.length}"`);
        await gate;
        return { ok: true, result: { provider: params.provider, accounts: [{ name: index === 0 ? "stale-account" : "fresh-account", source: "fixture", blocked: false, pinned: false }] } };
      });
    });
    await byTestId(page, TESTID.openSettings).click();
    await page.locator('[data-section="accounts"]').click();
    await expect(page.locator("html")).toHaveAttribute("data-qa-account-requests", "1");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator("html")).toHaveAttribute("data-qa-account-requests", "2");
    await app.evaluate(() => Reflect.get(globalThis, "releaseAccountRead")(1));
    const section = byTestId(page, TESTID.settingsAccounts);
    await expect(section).toHaveAttribute("aria-busy", "true");
    await expect(section.locator('[data-account="fresh-account"]')).toBeVisible();
    await expect(byTestId(page, TESTID.accountsRefresh)).toBeEnabled();
    await app.evaluate(() => Reflect.get(globalThis, "releaseAccountRead")(0));
    await expect(section).toHaveAttribute("aria-busy", "false");
    await expect(section.locator('[data-account="stale-account"]')).toHaveCount(0);
    await expect(section.locator('[data-account="fresh-account"]')).toBeVisible();
  } finally { await launched.close(); }
});
