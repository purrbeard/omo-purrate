import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import { expect, test, type Locator } from "@playwright/test";
import { ENV } from "../shared/ipc.ts";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, lastTurn, launchApp, newSession, send, setTheme, shot, type LaunchedApp } from "./helpers.ts";
import { tinyVideo } from "./media-video-fixture.ts";

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

function workspace(label: string) {
  const dir = test.info().outputPath(label);
  mkdirSync(dir, { recursive: true });
  const files = { shot: path.join(dir, "shot.png"), other: path.join(dir, "other.png"), clip: path.join(dir, "clip.mp4"), notes: path.join(dir, "notes.txt"), broken: path.join(dir, "broken.mp4") };
  writeFileSync(files.shot, png(160, 90, [200, 30, 40]));
  writeFileSync(files.other, png(90, 160, [30, 90, 200]));
  writeFileSync(files.clip, tinyVideo);
  writeFileSync(files.broken, "not an mp4");
  writeFileSync(files.notes, "hello");
  return { dir, ...files };
}

type Workspace = ReturnType<typeof workspace>;
const slash = (value: string): string => value.replaceAll("\\", "/");

async function launch(ws: Workspace, openLog: string): Promise<LaunchedApp> {
  // Keep every isolated profile and store as evidence; helper cleanup owns none of these directories.
  const userData = test.info().outputPath("user-data");
  const fakeHome = test.info().outputPath("fake-home");
  mkdirSync(userData, { recursive: true });
  mkdirSync(fakeHome, { recursive: true });
  const app = await launchApp({ omo: "fake", pickDir: ws.dir, userData, fakeHome, size: { width: 1280, height: 820 }, extraEnv: { [ENV.qaOpenLog]: openLog } });
  try {
  const state = await app.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    return { bounds: window.getBounds(), focused: window.isFocused(), visible: window.isVisible(), opacity: window.getOpacity() };
  });
  writeFileSync(test.info().outputPath("window-state.json"), JSON.stringify(state, null, 2));
  await test.info().attach("window-state", { body: JSON.stringify(state, null, 2), contentType: "application/json" });
  // Secondary-monitor placement is a local QA setting, not a CI hardware requirement.
  const position = process.env[ENV.qaWindowPosition];
  if (position !== undefined) {
    const [x, y] = position.split(",").map(Number);
    expect(state.bounds.x).toBe(x);
    expect(state.bounds.y).toBe(y);
    expect(state.focused).toBe(false);
    expect(state.visible).toBe(true);
    expect(state.opacity).toBe(1);
    if (position === "509,1440") {
      expect(state.bounds.x + state.bounds.width).toBeLessThanOrEqual(2429);
      expect(state.bounds.y + state.bounds.height).toBeLessThanOrEqual(2520);
      expect(state.bounds.width).toBeLessThanOrEqual(1800);
      expect(state.bounds.height).toBeLessThanOrEqual(1000);
    }
  }
  return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

/** Register exact events before load/play/seek; each event has a bounded timeout. */
async function playAndSeek(video: Locator): Promise<void> {
  const result = await video.evaluate(async (element: HTMLVideoElement) => {
    const event = (name: string): Promise<void> => new Promise((resolve, reject) => {
      const cleanup = (): void => { clearTimeout(timer); element.removeEventListener(name, done); element.removeEventListener("error", fail); };
      const done = (): void => { cleanup(); resolve(); };
      const fail = (): void => { cleanup(); reject(new Error(`video ${name}: ${element.error?.message ?? "decode error"}`)); };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`video ${name} timed out`)); }, 10000);
      element.addEventListener(name, done, { once: true });
      element.addEventListener("error", fail, { once: true });
    });
    const loaded = event("loadeddata");
    element.preload = "auto";
    element.load();
    await loaded;
    const playing = event("playing");
    await Promise.all([element.play(), playing]);
    const before = { width: element.videoWidth, height: element.videoHeight, duration: element.duration, paused: element.paused };
    element.pause();
    const seeked = event("seeked");
    element.currentTime = 1;
    await seeked;
    return { ...before, time: element.currentTime, error: element.error?.message ?? null };
  });
  expect(result).toMatchObject({ width: 160, height: 90, paused: false, time: 1, error: null });
  expect(result.duration).toBeGreaterThan(1);
  await test.info().attach("loadeddata-playing-seeked", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
}

function pathButton(scope: Locator, file: string): Locator {
  return scope.getByTestId(TESTID.pathChip).filter({ hasText: path.basename(file) }).first().getByRole("button").first();
}

test("chat paths open, and referenced images and videos preview inline", async () => {
  const ws = workspace("workspace");
  const openLog = test.info().outputPath("open.log");
  const launched = await launch(ws, openLog);
  try {
    const { page } = launched;
    await newSession(page);
    await send(page, `Compare ${slash(ws.shot)} with ${slash(ws.other)}, watch ${slash(ws.clip)} and read notes.txt or ${slash(path.join(ws.dir, "missing-file.png"))}`);
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
    const reply = byTestId(page, TESTID.assistantMessage).last();
    const thumbs = reply.getByTestId(TESTID.mediaThumb);
    await expect(thumbs).toHaveCount(2);
    await expect(thumbs.first()).toHaveJSProperty("complete", true);
    expect(await thumbs.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    expect(await thumbs.first().evaluate((img: HTMLImageElement) => img.naturalHeight)).toBeGreaterThan(0);
    expect(await thumbs.first().getAttribute("src")).toMatch(/^omo-media:\/\/local\//);
    await expect(reply.getByTestId(TESTID.mediaVideo)).toHaveAttribute("src", /^omo-media:\/\/local\/.*clip\.mp4$/);
    await playAndSeek(reply.getByTestId(TESTID.mediaVideo));
    await expect(reply.getByTestId(TESTID.pathChip).filter({ hasText: "missing-file.png" })).toHaveCount(0);
    await expect(reply).toContainText("missing-file.png");
    const notes = reply.locator(`[data-testid="${TESTID.pathChip}"][data-path$="notes.txt"]`).first();
    await notes.getByRole("button").first().click();
    await expect.poll(() => (existsSync(openLog) ? readFileSync(openLog, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { action: string; path: string }) : []))
      .toEqual([{ action: "open", path: expect.stringMatching(/notes\.txt$/) }]);
    expect(JSON.parse(readFileSync(openLog, "utf8").trim()).path.toLowerCase()).toBe(ws.notes.toLowerCase());
    await reply.getByRole("button", { name: /Enlarge shot\.png/ }).click();
    const lightbox = byTestId(page, TESTID.mediaLightbox);
    await expect(lightbox).toBeVisible();
    await expect(byTestId(page, TESTID.mediaLightboxImage)).toHaveAttribute("alt", "shot.png");
    await expect(byTestId(page, TESTID.mediaLightboxImage)).toHaveJSProperty("complete", true);
    expect(await byTestId(page, TESTID.mediaLightboxImage).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
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
  } finally { await launched.close(); }
});

test("a question that mentions an image shows it and still answers", async () => {
  const ws = workspace("question-workspace");
  const launched = await launch(ws, test.info().outputPath("open.log"));
  try {
    const { page } = launched;
    await newSession(page);
    await send(page, `SCENARIO:path-question:${slash(ws.shot)}`);
    const card = byTestId(page, TESTID.questionCard);
    await expect(card).toBeVisible();
    const thumb = card.getByTestId(TESTID.mediaThumb);
    await expect(thumb.first()).toBeVisible();
    await expect(thumb.first()).toHaveJSProperty("complete", true);
    expect(await thumb.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(card.locator("button:focus")).toHaveCount(0);
    await expect(card.locator(`h2 [data-testid="${TESTID.pathChip}"]`)).toHaveCount(1);
    await shot(page, "media-question");
    await card.locator(`[data-testid="${TESTID.questionOption}"][data-label="Keep"]`).getByText("Keep", { exact: true }).click();
    await byTestId(page, TESTID.questionSubmit).click();
    await expect(card).toBeHidden();
    await expect(byTestId(page, TESTID.assistantMessage).last()).toContainText("Chosen: Keep.");
  } finally { await launched.close(); }
});

test("Windows quoted paths and Markdown links preview once in main, user and side conversations", async () => {
  const ws = workspace("My Files [captures]");
  const folder = path.join(ws.dir, "photos.png");
  mkdirSync(folder);
  const openLog = test.info().outputPath("open.log");
  const launched = await launch(ws, openLog);
  try {
    const { page } = launched;
    const threadId = await newSession(page);
    const source = `image "${ws.shot}" video \`${ws.clip}\` quoted code \`"${ws.other}"\` folder "${folder}"\n\n[picture](<${ws.shot}>) [movie](<${ws.clip}>) [notes](<${ws.notes}>) [photos folder](<${folder}>)\n\n\`\`\`text\n${ws.shot}\n\`\`\``;
    await send(page, source);
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
    const user = byTestId(page, TESTID.userMessage).last();
    const reply = byTestId(page, TESTID.assistantMessage).last();
    await expect(user).toContainText(source.slice(0, source.indexOf("\n\n")));
    await expect(reply.locator("code").filter({ hasText: `"${ws.other}"` }).first()).toHaveText(`"${ws.other}"`);
    await expect(reply.locator("pre code")).toHaveText(`${ws.shot}\n`);
    for (const target of [user, reply]) {
      await pathButton(target, ws.shot).click();
      await expect(byTestId(page, TESTID.mediaLightboxImage)).toHaveAttribute("alt", "shot.png");
      await byTestId(page, TESTID.mediaLightboxClose).click();
      await pathButton(target, ws.clip).click();
      await playAndSeek(byTestId(page, TESTID.mediaLightbox).getByTestId(TESTID.mediaVideo));
      await shot(page, target === user ? "A-user-video" : "A-assistant-video");
      await byTestId(page, TESTID.mediaLightboxClose).click();
    }
    await reply.getByRole("button", { name: "picture", exact: true }).click();
    await expect(byTestId(page, TESTID.mediaLightboxImage)).toHaveAttribute("alt", "shot.png");
    await byTestId(page, TESTID.mediaLightboxClose).click();
    await reply.getByRole("button", { name: "movie", exact: true }).click();
    await playAndSeek(byTestId(page, TESTID.mediaLightbox).getByTestId(TESTID.mediaVideo));
    await byTestId(page, TESTID.mediaLightboxClose).click();
    expect(existsSync(openLog)).toBe(false);
    await reply.getByRole("button", { name: "notes", exact: true }).click();
    await expect.poll(() => existsSync(openLog) ? readFileSync(openLog, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []).toEqual([{ action: "open", path: ws.notes }]);
    await reply.getByRole("button", { name: "photos folder", exact: true }).click();
    await expect(byTestId(page, TESTID.mediaLightbox)).toHaveCount(0);
    await expect.poll(() => readFileSync(openLog, "utf8").trim().split("\n").map((line) => JSON.parse(line))).toEqual([{ action: "open", path: ws.notes }, { action: "open", path: folder }]);
    const prompts = launched.readFakeLog().filter((entry) => entry["type"] === "prompt");
    expect(prompts.some((entry) => entry["threadId"] === threadId && entry["message"] === source)).toBe(true);
    writeFileSync(test.info().outputPath("raw-prompt.json"), JSON.stringify(prompts, null, 2));
    await test.info().attach("raw-prompt", { body: JSON.stringify(prompts, null, 2), contentType: "application/json" });
    await send(page, `/btw look at \`${ws.clip}\``);
    const side = byTestId(page, TESTID.sidePanel);
    const sideReply = side.getByTestId(TESTID.assistantMessage).last();
    await expect(side.getByTestId(TESTID.sideTurn).last()).toHaveAttribute("data-status", "completed");
    await pathButton(sideReply, ws.clip).click();
    await playAndSeek(byTestId(page, TESTID.mediaLightbox).getByTestId(TESTID.mediaVideo));
    await shot(page, "A-side-video");
    await byTestId(page, TESTID.mediaLightboxClose).click();
    await pathButton(side.getByTestId(TESTID.sideQuestion).last(), ws.clip).click();
    await playAndSeek(byTestId(page, TESTID.mediaLightbox).getByTestId(TESTID.mediaVideo));
    await shot(page, "A-side-user-video");
    await byTestId(page, TESTID.mediaLightboxClose).click();
    for (const width of [1280, 760]) {
      await launched.app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setContentSize(width, 820), width);
      for (const theme of ["light", "dark"] as const) {
        await setTheme(page, theme);
        await shot(page, `A-media-${width}-${theme}`);
      }
    }
  } finally { await launched.close(); }
});

test("undecodable video reports failure and missing media stays literal", async () => {
  const ws = workspace("errors");
  const openLog = test.info().outputPath("open.log");
  const launched = await launch(ws, openLog);
  try {
    const { page } = launched;
    await newSession(page);
    await send(page, `broken \`${ws.broken}\` missing \`${path.join(ws.dir, "missing.png")}\``);
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
    const reply = byTestId(page, TESTID.assistantMessage).last();
    await expect(reply.getByTestId(TESTID.pathChip).filter({ hasText: "missing.png" })).toHaveCount(0);
    await pathButton(reply, ws.broken).click();
    await expect(byTestId(page, TESTID.mediaLightbox).getByRole("alert")).toBeVisible();
    expect(existsSync(openLog)).toBe(false);
    await shot(page, "A-media-decode-error");
  } finally { await launched.close(); }
});
