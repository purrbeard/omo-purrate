import { rmSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, shot, tempDir, threadRow, type LaunchedApp } from "./helpers.ts";

test.use({ trace: { mode: "retain-on-failure", snapshots: false } });

const LONG_ID = "timeline-session";
const TURNS = 90;

let launched: LaunchedApp | null = null;
let pickDir = "";

const current = (): LaunchedApp => {
  if (launched === null) throw new Error("the app is not running");
  return launched;
};

const step = (page: Page, n: number): Locator => byTestId(page, TESTID.turn).filter({ hasText: `Step ${n}: check how` });

/** The turn's top edge measured from the transcript scroller's top edge. */
function offsetFromTop(turn: Locator): Promise<number> {
  return turn.evaluate((element) => {
    let scroller = element.parentElement;
    while (scroller !== null && getComputedStyle(scroller).overflowY !== "auto") scroller = scroller.parentElement;
    if (scroller === null) throw new Error("no transcript scroller");
    return Math.round(element.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
  });
}

/** A smooth jump settles over a few frames, so the landing position is polled until it is just below the top edge. */
async function expectLanded(turn: Locator): Promise<void> {
  await expect.poll(() => offsetFromTop(turn)).toBeGreaterThanOrEqual(20);
  await expect.poll(() => offsetFromTop(turn)).toBeLessThanOrEqual(28);
}

async function pointAt(page: Page, index: number): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId("timeline-minimap-rail").boundingBox();
  if (box === null) throw new Error("the timeline rail is not laid out");
  return { x: box.x + box.width / 2, y: box.y + (box.height * index) / (TURNS - 1) };
}

test.beforeAll(async () => {
  pickDir = tempDir("timeline");
  launched = await launchApp({
    omo: "fake",
    pickDir,
    managed: [LONG_ID],
    size: { width: 1280, height: 860 },
    extraEnv: { FAKE_OMO_LONG_SESSION: JSON.stringify({ id: LONG_ID, cwd: pickDir, turns: TURNS, toolCalls: 3 }) },
  });
});

test.afterAll(async () => {
  await launched?.close();
  launched = null;
  if (pickDir !== "") rmSync(pickDir, { recursive: true, force: true });
});

test("the timeline rail previews a message and jumps to it, past the lazily rendered window", async () => {
  // Given: a 90-turn session, of which the transcript renders the latest 40.
  const { page } = current();
  await threadRow(page, LONG_ID).getByRole("button").first().click();
  await expect(step(page, TURNS)).toBeAttached();
  await expect(byTestId(page, TESTID.turn)).toHaveCount(40);
  await expect(step(page, 5)).toHaveCount(0);
  await expect(page.getByTestId("timeline-minimap-tick")).toHaveCount(TURNS);

  // When: hovering the fifth tick
  const fifth = await pointAt(page, 4);
  await page.mouse.move(fifth.x, fifth.y);
  // Then: it previews that message
  await expect(page.getByTestId("timeline-minimap-preview")).toContainText("Step 5: check how the cart totals are computed.");
  await shot(page, "timeline-minimap-preview");

  // When: clicking it
  await page.mouse.click(fifth.x, fifth.y);
  // Then: the window widens to that turn and the turn sits just below the top edge, marked as the jump target.
  await expect(step(page, 5)).toHaveAttribute("data-jump-target", "true");
  await expectLanded(step(page, 5));
  await expect(page.getByTestId("timeline-minimap-tick").nth(4)).toHaveAttribute("data-in-view", "true");
  await shot(page, "timeline-minimap-jumped");

  // When / Then: the previous-turn arrow steps one message back.
  await page.getByTestId("timeline-minimap-previous").click();
  await expect(step(page, 4)).toHaveAttribute("data-jump-target", "true");
  await expectLanded(step(page, 4));

  // When / Then: the keyboard picks the first message.
  await page.getByTestId("timeline-minimap-rail").focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(step(page, 1)).toHaveAttribute("data-jump-target", "true");
  await expectLanded(step(page, 1));
});
