import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, newSession, send, shot, tempDir, prompts } from "./helpers.ts";

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
