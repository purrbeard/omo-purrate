import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, lastTurn, launchApp, newSession, send, threadRow, WT } from "./helpers.ts";

test("prompt recall restores its draft across session changes without replacing IME or multiline edits", async () => {
  const launched = await launchApp({ omo: "fake", pickDir: WT });
  try {
    const { page } = launched;
    const first = await newSession(page);
    await send(page, "older prompt");
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
    await send(page, "newer prompt\nsecond line");
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
    const input = byTestId(page, TESTID.composerInput);
    await input.fill("original draft");
    await input.press("ControlOrMeta+Home");
    await input.press("ArrowUp");
    await expect(input).toHaveValue("newer prompt\nsecond line");
    await input.press("ArrowUp");
    await expect(input).toHaveValue("older prompt");
    const second = await newSession(page);
    await input.press("ArrowUp");
    await expect(input).toHaveValue("");
    await threadRow(page, first).click();
    await expect(input).toHaveAttribute("data-thread-id", first);
    await expect(input).toHaveValue("older prompt");
    await input.press("ArrowDown");
    await expect(input).toHaveValue("newer prompt\nsecond line");
    await input.press("ArrowDown");
    await expect(input).toHaveValue("original draft");
    await input.fill("editing\nmultiple lines");
    await input.press("ControlOrMeta+Home");
    await input.press("ArrowUp");
    await expect(input).toHaveValue("editing\nmultiple lines");
    await input.fill("");
    await input.dispatchEvent("keydown", { key: "ArrowUp", isComposing: true, keyCode: 229 });
    await expect(input).toHaveValue("");
    await input.press("ArrowUp");
    await expect(input).toHaveValue("newer prompt\nsecond line");
    await input.fill("edited recall");
    await input.press("ArrowDown");
    await expect(input).toHaveValue("edited recall");
    await threadRow(page, second).click();
    await expect(input).toHaveValue("");
    await threadRow(page, first).click();
    await expect(input).toHaveValue("edited recall");
  } finally { await launched.close(); }
});

test("prompt recall reaches the oldest prompt when earlier tool output is outlined", async () => {
  const id = "recall-long-session";
  const launched = await launchApp({ omo: "fake", pickDir: WT, managed: [id],
    extraEnv: { FAKE_OMO_LONG_SESSION: JSON.stringify({ id, cwd: WT, turns: 30, toolCalls: 0 }) } });
  try {
    const { page } = launched;
    await threadRow(page, id).getByRole("button").first().click();
    await expect(byTestId(page, TESTID.turn)).toHaveCount(30);
    const input = byTestId(page, TESTID.composerInput);
    for (let step = 30; step >= 1; step -= 1) {
      await input.press("ArrowUp");
      await expect(input).toHaveValue(`Step ${step}: check how the cart totals are computed.`);
    }
  } finally { await launched.close(); }
});
