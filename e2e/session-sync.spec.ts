import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, shot, tempDir, threadRow } from "./helpers.ts";

const THREAD = "sync-thread";

function line(entry: Record<string, unknown>): string {
  return JSON.stringify(entry) + "\n";
}

function message(id: string, parentId: string | null, role: "user" | "assistant", text: string): string {
  return line({ type: "message", id, parentId, timestamp: new Date().toISOString(),
    message: { role, content: [{ type: "text", text }], ...(role === "assistant" ? { stopReason: "stop" } : {}) } });
}

test("an open session follows what another omo process appends to its file", async () => {
  const fakeHome = tempDir("sync-home");
  const pickDir = tempDir("sync-workspace");
  const dir = path.join(fakeHome, "sessions");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${THREAD}.jsonl`);
  writeFileSync(file, line({ type: "session", version: 3, id: THREAD, timestamp: new Date().toISOString(), cwd: pickDir })
    + message("u1", null, "user", "Question asked in OmO UI") + message("a1", "u1", "assistant", "Answer shown in OmO UI"));
  const launched = await launchApp({ omo: "fake", fakeHome, pickDir, managed: [THREAD] });
  try {
    const { page } = launched;
    await threadRow(page, THREAD).getByRole("button").first().click();
    await expect(page.getByText("Answer shown in OmO UI")).toBeVisible();

    // A torn trailing line, as a writer mid-append leaves it, must not break the view.
    appendFileSync(file, message("u2", "a1", "user", "Question typed in the terminal") + '{"type":"message","id":"a2","par');
    await expect(page.getByText("Question typed in the terminal")).toBeVisible();
    await expect(byTestId(page, TESTID.noticeToast).first()).toBeVisible();

    appendFileSync(file, 'entId":"u2"}\n' + message("a2b", "u2", "assistant", "Answer written by the terminal"));
    await expect(page.getByText("Answer written by the terminal")).toBeVisible();
    await expect(page.getByText("Answer shown in OmO UI")).toBeVisible();

    appendFileSync(file, line({ type: "model_change", id: "m1", parentId: "a2b", timestamp: new Date().toISOString(), provider: "fake", modelId: "beta" }));
    await expect(byTestId(page, TESTID.modelPicker)).toContainText("Fake Beta");
    await shot(page, "session-sync");
  } finally {
    await launched.close();
    for (const target of [fakeHome, pickDir]) rmSync(target, { recursive: true, force: true });
  }
});
