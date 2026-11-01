import { mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { quarantineSync } from "../scripts/quarantine-temp.mjs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ENV } from "../shared/ipc.ts";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, newSession, setTheme, shot, WT } from "./helpers.ts";
import type { LaunchedApp } from "./helpers.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=";

async function sendAndReceivePrompt(launched: LaunchedApp, threadId: string): Promise<Record<string, unknown>> {
  const logPath = launched.dirs.fakeLog;
  if (logPath === null) throw new Error("fake log path is required");
  const readPrompts = (): Record<string, unknown>[] => {
    const text = readFileSync(logPath, "utf8");
    return text.slice(0, text.lastIndexOf("\n") + 1).split("\n").flatMap(line => {
      if (!line) return [];
      const frame: unknown = JSON.parse(line);
      return typeof frame === "object" && frame !== null && !Array.isArray(frame) && "type" in frame && frame.type === "prompt" && "threadId" in frame && frame.threadId === threadId
        ? [frame] : [];
    });
  };
  const before = readPrompts().length;
  const watcher = watch(logPath);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const received = new Promise<Record<string, unknown>>((resolve, reject) => {
    watcher.on("change", () => {
      try {
        const prompt = readPrompts()[before];
        if (prompt !== undefined) resolve(prompt);
      } catch (error) { reject(error); }
    });
    watcher.once("error", reject);
    timeout = setTimeout(() => reject(new Error("native did not receive the attachment prompt")), 30_000);
  });
  try {
    const [prompt] = await Promise.all([received, byTestId(launched.page, TESTID.composerSend).click()]);
    return prompt;
  } finally {
    clearTimeout(timeout);
    watcher.close();
  }
}

test("picker sends local images and echoes user thumbnails", async () => {
  const dir = path.join(WT, "test-results", "attachment-picker");
  mkdirSync(dir, { recursive: true });
  const image = path.join(dir, "picked.png");
  writeFileSync(image, Buffer.from(PNG, "base64"));
  const launched = await launchApp({ omo: "fake", pickDir: dir, extraEnv: { [ENV.qaPickAttachments]: JSON.stringify([image]) } });
  try {
    const { page } = launched;
    const threadId = await newSession(page);
    await byTestId(page, TESTID.attachmentPick).click();
    await expect(byTestId(page, TESTID.attachmentThumbnail)).toHaveCount(1);
    await byTestId(page, TESTID.composerInput).fill("Describe this image");
    const request = await sendAndReceivePrompt(launched, threadId);
    await expect(byTestId(page, TESTID.userMessage).locator("img")).toBeVisible();
    await expect(byTestId(page, TESTID.userMessage)).toContainText("Describe this image");
    await expect(byTestId(page, TESTID.userMessage)).not.toContainText("Attached images");
    expect(request).toMatchObject({
      message: "Describe this image",
      images: [{ type: "image", mimeType: "image/png", data: PNG }],
    });
  } finally { await launched.close(); quarantineSync(dir, { recursive: true, force: true }); }
});

test("paste and drop preview, remove, and send image-only", async () => {
  const launched = await launchApp({ omo: "fake", pickDir: WT });
  try {
    const { page } = launched;
    const threadId = await newSession(page);
    await page.evaluate(({ png, inputId, cardId }) => {
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const paste = new DataTransfer();
      paste.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
      document.querySelector(`[data-testid="${inputId}"]`)!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: paste, bubbles: true, cancelable: true }));
      const drop = new DataTransfer();
      drop.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
      document.querySelector(`[data-testid="${cardId}"]`)!.dispatchEvent(new DragEvent("drop", { dataTransfer: drop, bubbles: true, cancelable: true }));
    }, { png: PNG, inputId: TESTID.composerInput, cardId: TESTID.composer });
    await expect(byTestId(page, TESTID.attachmentThumbnail)).toHaveCount(2);
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await shot(page, `G012-composer-${theme}`);
    }
    await byTestId(page, TESTID.attachmentRemove).first().click();
    await expect(byTestId(page, TESTID.attachmentThumbnail)).toHaveCount(1);
    await expect(byTestId(page, TESTID.composerSend)).toBeEnabled();
    const request = await sendAndReceivePrompt(launched, threadId);
    await expect(byTestId(page, TESTID.userMessage).locator("img")).toBeVisible();
    expect(request).toMatchObject({
      message: "",
      images: [{ type: "image", mimeType: "image/png", data: PNG }],
    });
    await expect(byTestId(page, TESTID.userMessage).locator("img")).toHaveJSProperty("complete", true);
    expect(await byTestId(page, TESTID.userMessage).locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    await expect(byTestId(page, TESTID.attachmentThumbnail)).toHaveCount(0);
  } finally { await launched.close(); }
});

test("the paperclip attaches any file type as a file reference", async () => {
  const dir = path.join(WT, "test-results", "attachment-any-file");
  mkdirSync(dir, { recursive: true });
  const document = path.join(dir, "notes.pdf");
  const archive = path.join(dir, "bundle.zip");
  writeFileSync(document, "%PDF-1.4\n");
  writeFileSync(archive, "PK");
  const launched = await launchApp({ omo: "fake", pickDir: dir, extraEnv: { [ENV.qaPickAttachments]: JSON.stringify([document, archive]) } });
  try {
    const { page } = launched;
    const threadId = await newSession(page);
    await byTestId(page, TESTID.attachmentPick).click();
    await expect(page.getByTestId("context-chip")).toHaveText(["notes.pdf", "bundle.zip"]);
    await expect(byTestId(page, TESTID.attachmentNotice)).toHaveCount(0);
    await byTestId(page, TESTID.composerInput).fill("Read these");
    const request = await sendAndReceivePrompt(launched, threadId);
    const text = String(request?.message);
    expect(text).toContain(JSON.stringify(document));
    expect(text).toContain(JSON.stringify(archive));
  } finally { await launched.close(); quarantineSync(dir, { recursive: true, force: true }); }
});
