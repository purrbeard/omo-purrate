import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, lastTurn, launchApp, newSession, send, shot, tempDir, prompts } from "./helpers.ts";

test("fast mode toggles for a ChatGPT model and reports omo's refusal on any other", async () => {
  const launched = await launchApp({ omo: "fake", pickDir: tempDir("fast-mode") });
  const { page } = launched;
  try {
    const threadId = await newSession(page);
    const toggle = byTestId(page, TESTID.fastModeToggle);

    // The default Fake Alpha model carries no priority tier, so omo refuses the change.
    await byTestId(page, TESTID.modelPicker).click();
    await toggle.click();
    await expect(byTestId(page, TESTID.noticeToast)).toContainText("Fast mode is only available for ChatGPT Subscription models.");

    await byTestId(page, TESTID.specificModelTab).click();
    await byTestId(page, TESTID.modelOption).filter({ hasText: "GPT-6 Sol Fast" }).click();
    await expect(byTestId(page, TESTID.modelPicker)).toContainText("GPT-6 Sol Fast");
    // omo takes the model from the turn, so the switch has to reach it before the tier can change.
    await send(page, "ping");
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");

    await byTestId(page, TESTID.modelPicker).click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await shot(page, "fast-mode-on");
    await expect
      .poll(launched.readFakeLog)
      .toContainEqual(expect.objectContaining({ type: "set_fast_mode", threadId, enabled: true }));

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(launched.readFakeLog)
      .toContainEqual(expect.objectContaining({ type: "set_fast_mode", threadId, enabled: false }));
  } finally { await launched.close(); }
});

test("continuing a conversation on another model is held once with a warning, then goes through", async () => {
  const launched = await launchApp({ omo: "fake", pickDir: tempDir("model-switch") });
  const { page } = launched;
  try {
    const threadId = await newSession(page);
    const turns = page.getByTestId("conversation").getByTestId(TESTID.turn);
    await send(page, "first question");
    await expect(turns.last()).toHaveAttribute("data-status", "completed");

    await byTestId(page, TESTID.modelPicker).click();
    await byTestId(page, TESTID.specificModelTab).click();
    await byTestId(page, TESTID.modelOption).filter({ hasText: "Fake Beta" }).click();
    await expect(byTestId(page, TESTID.modelPicker)).toContainText("Fake Beta");

    const input = byTestId(page, TESTID.composerInput);
    await input.fill("second question");
    await byTestId(page, TESTID.composerSend).click();
    const toast = byTestId(page, TESTID.noticeToast);
    await expect(toast).toContainText("Fake Alpha");
    await expect(toast).toContainText("Fake Beta");
    await expect(input).toHaveValue("second question");
    await expect(turns).toHaveCount(1);
    expect(prompts(launched.readFakeLog())).toHaveLength(1);
    await shot(page, "model-switch-warning", { maxSettleMs: 500 });

    await byTestId(page, TESTID.composerSend).click();
    await expect(turns).toHaveCount(2);
    await expect(turns.last()).toHaveAttribute("data-status", "completed");
    expect(launched.readFakeLog().filter(entry => entry["type"] === "set_model").at(-1)).toMatchObject({ threadId, provider: "fake", modelId: "beta" });

    await send(page, "third question");
    await expect(turns).toHaveCount(3);
    await expect(turns.last()).toHaveAttribute("data-status", "completed");
    expect(prompts(launched.readFakeLog())).toHaveLength(3);
  } finally { await launched.close(); }
});
