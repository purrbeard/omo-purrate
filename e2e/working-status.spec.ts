import { rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, lastTurn, launchApp, newSession, send, shot, tempDir } from "./helpers.ts";

test("a silent turn shows how long it has run, and a message sent into it says it is queued", async () => {
  const fakeHome = tempDir("fake-home");
  const pickDir = tempDir("workspace");
  const launched = await launchApp({ omo: "fake", fakeHome, pickDir });
  try {
    const { page, readFakeLog } = launched;
    await newSession(page);
    await send(page, "SCENARIO:quiet:6000 long think");
    const working = byTestId(page, TESTID.workingIndicator);
    const detail = byTestId(page, TESTID.workingDetail);
    await expect(working).toBeVisible();
    await expect(detail).toHaveText(/^\d+s/);
    await expect(working).not.toHaveAttribute("data-queued");
    // A message within the first second is read as the turn's own prompt; wait until the turn has clearly been running.
    await expect(detail).toHaveText(/^[2-9]s/, { timeout: 5_000 });

    await send(page, "are you still there?");
    await expect.poll(readFakeLog).toContainEqual(expect.objectContaining({ method: "turn/steer" }));
    await expect(working).toHaveAttribute("data-queued", "true");
    await expect(detail).toContainText("your message is queued");
    await shot(page, "working-queued");

    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed", { timeout: 15_000 });
    await expect(working).toBeHidden();
  } finally {
    await launched.close();
    for (const dir of [fakeHome, pickDir]) rmSync(dir, { recursive: true, force: true });
  }
});
