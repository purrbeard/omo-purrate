import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
    const calls = (await readFakeLog()).filter((entry) => String(entry["method"]).startsWith("account/providerAccounts/") && !String(entry["method"]).endsWith("/read"));
    expect(calls.map((entry) => [entry["method"], entry["params"]])).toEqual([
      ["account/providerAccounts/pin", { provider: "anthropic-subscription", name: "work" }],
      ["account/providerAccounts/remove", { provider: "anthropic-subscription", name: "old" }],
    ]);
    await shot(page, "accounts-after");
  } finally {
    await launched.close();
    rmSync(fakeHome, { recursive: true, force: true });
  }
});
