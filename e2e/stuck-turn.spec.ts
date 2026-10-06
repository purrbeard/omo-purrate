import { rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, lastTurn, launchApp, newSession, send, shot, tempDir, type LaunchedApp } from "./helpers.ts";

let fakeHome = "";
let pickDir = "";
let launched: LaunchedApp | null = null;

const current = (): LaunchedApp => {
  if (launched === null) throw new Error("the app is not running");
  return launched;
};

test.beforeAll(async () => {
  fakeHome = tempDir("fake-home");
  pickDir = tempDir("workspace");
  launched = await launchApp({ omo: "fake", fakeHome, pickDir });
});

test.afterAll(async () => {
  await launched?.close();
  launched = null;
  for (const dir of [fakeHome, pickDir]) if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

test("a turn whose turn/completed never arrives settles on the idle status and the next message starts a new turn", async () => {
  const { page, readFakeLog } = current();
  await newSession(page);
  await send(page, "SCENARIO:lost-completion first");
  await expect(byTestId(page, TESTID.assistantMessage)).toHaveCount(1);

  await expect(byTestId(page, TESTID.workingIndicator)).toBeHidden({ timeout: 5_000 });
  await expect(byTestId(page, TESTID.composerStop)).toBeHidden();
  await expect(lastTurn(page)).not.toHaveAttribute("data-status", "inProgress");

  await send(page, "second message");
  await expect
    .poll(readFakeLog)
    .toContainEqual(
      expect.objectContaining({
        method: "turn/start",
        params: expect.objectContaining({ input: [expect.objectContaining({ text: "second message" })] }),
      }),
    );
  await expect(byTestId(page, TESTID.assistantMessage)).toHaveCount(2);
  await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
  await expect(byTestId(page, TESTID.workingIndicator)).toBeHidden();
  await shot(page, "G011-recovered");
});

test("a rejected steer into a turn omo already ended sends the message as a new turn", async () => {
  const { page, readFakeLog } = current();
  await newSession(page);
  await send(page, "SCENARIO:silent-end first");
  // The whole reply has arrived only after the fake finished the turn; a message sent earlier would be a valid steer.
  await expect(byTestId(page, TESTID.assistantMessage)).toHaveText("echo: SCENARIO:silent-end first");
  await expect(byTestId(page, TESTID.composerStop)).toBeVisible();

  await send(page, "after a silent end");
  await expect
    .poll(readFakeLog)
    .toContainEqual(
      expect.objectContaining({
        method: "turn/start",
        params: expect.objectContaining({ input: [expect.objectContaining({ text: "after a silent end" })] }),
      }),
    );
  await expect(byTestId(page, TESTID.assistantMessage)).toHaveCount(2);
  await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
  await expect(byTestId(page, TESTID.composerStop)).toBeHidden();
  await expect(byTestId(page, TESTID.workingIndicator)).toBeHidden();
});
