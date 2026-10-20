import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import { expect, test } from "@playwright/test";
import { ENV } from "../shared/ipc.ts";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, lastTurn, launchApp, newSession, send, setTheme, shot } from "./helpers.ts";

/** A solid-color PNG, so a thumbnail has a real natural size. */
function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function workspace(label: string): { dir: string; shot: string; other: string; clip: string; notes: string } {
  const dir = test.info().outputPath(label);
  mkdirSync(dir, { recursive: true });
  const files = { shot: path.join(dir, "shot.png"), other: path.join(dir, "other.png"), clip: path.join(dir, "clip.mp4"), notes: path.join(dir, "notes.txt") };
  writeFileSync(files.shot, png(160, 90, [200, 30, 40]));
  writeFileSync(files.other, png(90, 160, [30, 90, 200]));
  writeFileSync(files.clip, Buffer.alloc(2048));
  writeFileSync(files.notes, "hello");
  return { dir, ...files };
}

const slash = (value: string): string => value.replaceAll("\\", "/");

test("chat paths open, and referenced images and videos preview inline", async () => {
  const ws = workspace("workspace");
  const openLog = test.info().outputPath("open.log");
  const launched = await launchApp({ omo: "fake", pickDir: ws.dir, extraEnv: { [ENV.qaOpenLog]: openLog } });
  try {
    const { page } = launched;
    await newSession(page);
    await send(page, `Compare ${slash(ws.shot)} with ${slash(ws.other)}, watch ${slash(ws.clip)} and read notes.txt or ${slash(path.join(ws.dir, "missing-file.png"))}`);
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
    const reply = byTestId(page, TESTID.assistantMessage).last();

    // Images preview as real thumbnails, served by the media protocol.
    const thumbs = reply.getByTestId(TESTID.mediaThumb);
    await expect(thumbs).toHaveCount(2);
    await expect.poll(() => thumbs.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect.poll(() => thumbs.first().evaluate((img: HTMLImageElement) => img.naturalHeight)).toBeGreaterThan(0);
    expect(await thumbs.first().getAttribute("src")).toMatch(/^omo-media:\/\/local\//);

    // The video gets a player; a path that does not exist stays plain text.
    await expect(reply.getByTestId(TESTID.mediaVideo)).toHaveAttribute("src", /^omo-media:\/\/local\/.*clip\.mp4$/);
    await expect(reply.getByTestId(TESTID.pathChip).filter({ hasText: "missing-file.png" })).toHaveCount(0);
    await expect(reply).toContainText("missing-file.png");

    // Clicking a text path opens it (recorded by the QA hook instead of launching an app).
    const notes = reply.locator(`[data-testid="${TESTID.pathChip}"][data-path$="notes.txt"]`).first();
    await notes.getByRole("button").first().click();
    await expect.poll(() => (existsSync(openLog) ? readFileSync(openLog, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { action: string; path: string }) : []))
      .toEqual([{ action: "open", path: expect.stringMatching(/notes\.txt$/) }]);
    expect(JSON.parse(readFileSync(openLog, "utf8").trim()).path.toLowerCase()).toBe(ws.notes.toLowerCase());

    // Lightbox: open, step to the other image with the arrow key, close with Escape.
    await reply.getByRole("button", { name: /Enlarge shot\.png/ }).click();
    const lightbox = byTestId(page, TESTID.mediaLightbox);
    await expect(lightbox).toBeVisible();
    await expect(byTestId(page, TESTID.mediaLightboxImage)).toHaveAttribute("alt", "shot.png");
    await expect.poll(() => byTestId(page, TESTID.mediaLightboxImage).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await shot(page, "media-lightbox-light");
    await page.keyboard.press("ArrowRight");
    await expect(byTestId(page, TESTID.mediaLightboxImage)).toHaveAttribute("alt", "other.png");
    await page.keyboard.press("Escape");
    await expect(lightbox).toBeHidden();

    await setTheme(page, "light");
    await reply.scrollIntoViewIfNeeded();
    await shot(page, "media-light");
    await setTheme(page, "dark");
    await shot(page, "media-dark");
  } finally {
    await launched.close();
  }
});

test("a question that mentions an image shows it and still answers", async () => {
  const ws = workspace("question-workspace");
  const launched = await launchApp({ omo: "fake", pickDir: ws.dir, extraEnv: { [ENV.qaOpenLog]: test.info().outputPath("open.log") } });
  try {
    const { page } = launched;
    await newSession(page);
    await send(page, `SCENARIO:path-question:${slash(ws.shot)}`);
    const card = byTestId(page, TESTID.questionCard);
    await expect(card).toBeVisible();
    const thumb = card.getByTestId(TESTID.mediaThumb);
    await expect(thumb.first()).toBeVisible();
    await expect.poll(() => thumb.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    // Previews never take keyboard focus away from the answer controls.
    await expect(card.locator("button:focus")).toHaveCount(0);
    // The path in the question text is a chip; the one inside an option stays inside the option button.
    await expect(card.locator(`h2 [data-testid="${TESTID.pathChip}"]`)).toHaveCount(1);
    await shot(page, "media-question");
    // Click the label, not the middle of the option: the path chip inside its description opens the file instead.
    await card.locator(`[data-testid="${TESTID.questionOption}"][data-label="Keep"]`).getByText("Keep", { exact: true }).click();
    await byTestId(page, TESTID.questionSubmit).click();
    await expect(card).toBeHidden();
    await expect(byTestId(page, TESTID.assistantMessage).last()).toContainText("Chosen: Keep.");
  } finally {
    await launched.close();
  }
});
