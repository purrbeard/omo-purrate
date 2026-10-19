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

    // File tool results the terminal recorded are the session's change history, independent of git.
    const inside = `${pickDir.replaceAll("\\", "/")}/src/app.ts`;
    const outside = path.join(fakeHome, "notes.md");
    const patch = `--- ${inside}\n+++ ${inside}\n@@ -1,2 +1,2 @@\n keep\n-old line\n+new line\n`;
    const at = new Date().toISOString();
    appendFileSync(file, message("u3", "m1", "user", "Edit files from the terminal")
      + line({ type: "message", id: "a3", parentId: "u3", timestamp: at, message: { role: "assistant", stopReason: "toolUse", content: [
        { type: "toolCall", id: "edit-1", name: "edit", arguments: { path: inside, edits: [{ oldText: "old line", newText: "new line" }] } },
        { type: "toolCall", id: "write-1", name: "write", arguments: { path: outside, content: "one\ntwo\n" } },
      ] } })
      + line({ type: "message", id: "r1", parentId: "a3", timestamp: at, message: { role: "toolResult", toolCallId: "edit-1", toolName: "edit", content: [{ type: "text", text: "ok" }], details: { patch } } })
      + line({ type: "message", id: "r2", parentId: "r1", timestamp: at, message: { role: "toolResult", toolCallId: "write-1", toolName: "write", content: [{ type: "text", text: "ok" }], details: { operation: "add", patch: `--- /dev/null\n+++ ${outside}\n@@ -0,0 +1,2 @@\n+one\n+two\n` } } })
      + message("a4", "r2", "assistant", "Edited two files"));
    const card = page.getByTestId("edited-files").last();
    await expect(card.locator('li[data-path="src/app.ts"]')).toContainText("+1 -1");
    // Outside the session cwd the path stays absolute.
    await expect(card.locator("li").filter({ hasText: outside })).toContainText("+2 -0");
    await card.getByTestId("edited-files-view").click();
    const turn = page.getByTestId("workspace-session-turn").filter({ hasText: "Edit files from the terminal" });
    await expect(turn).toHaveAttribute("data-focused", "true");
    await expect(page.getByTestId("workspace-session-git")).toHaveCount(0);
    const changed = turn.locator('[data-testid="workspace-session-file"][data-path="src/app.ts"]');
    await changed.locator("summary").click();
    await expect(changed).toContainText("new line");
    await expect(changed).toContainText("old line");
    await shot(page, "session-sync-changes");
  } finally {
    await launched.close();
    for (const target of [fakeHome, pickDir]) rmSync(target, { recursive: true, force: true });
  }
});
