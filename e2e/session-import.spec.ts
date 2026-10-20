import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { processStartTimes } from "../electron/omo/session-holders.ts";
import { launchApp, newSession, send, tempDir, threadRow, openNativeSessions } from "./helpers.ts";

const UUID = /^omo-ui:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function entries(file: string): Record<string, unknown>[] {
  return readFileSync(file, "utf8").split("\n").filter(line => line.trim() !== "").map(line => JSON.parse(line) as Record<string, unknown>);
}

test("a session started in the app records who created it before its first message", async () => {
  const home = tempDir("origin-home");
  const running = await launchApp({ omo: "fake", fakeHome: home, pickDir: tempDir("origin-workspace") });
  try {
    const threadId = await newSession(running.page);
    await send(running.page, "hello from the app");
    const file = path.join(home, "sessions", `${threadId}.jsonl`);
    await expect.poll(() => entries(file).some(entry => entry["type"] === "message"), { timeout: 20_000 }).toBe(true);
    const lines = entries(file);
    const marker = lines.findIndex(entry => entry["type"] === "custom" && entry["customType"] === "omo-ui.origin");
    const admission = lines.find(entry => entry["type"] === "custom" && entry["customType"] === "rpc_client_message_admission");
    const firstUser = lines.findIndex(entry => entry["type"] === "message" && (entry["message"] as { role?: string }).role === "user");
    expect(marker).toBeGreaterThan(0);
    expect(marker).toBeLessThan(firstUser);
    expect((admission?.["data"] as { clientMessageId?: string }).clientMessageId).toMatch(UUID);
  } finally { await running.close(); }
});

interface Seed { id: string; file: string }

function seedStore(home: string): Record<string, Seed> {
  const work = path.resolve("/work/import-e2e");
  const folder = path.join(home, "sessions", "--work-import-e2e--");
  mkdirSync(folder, { recursive: true });
  let count = 0;
  const write = (label: string, body: (id: string) => object[], options: { cwd?: string; header?: object; raw?: string } = {}): Seed => {
    count += 1;
    const id = `0190f0c0-0000-7000-8000-${String(count).padStart(12, "0")}`;
    const file = path.join(folder, `2026-10-0${count}_${id}.jsonl`);
    let parentId: string | null = null;
    const lines: object[] = [{ type: "session", version: 3, id, timestamp: `2026-10-0${count}T00:00:00.000Z`, cwd: options.cwd ?? work, ...options.header }];
    for (const [position, entry] of body(id).entries()) {
      const entryId = `${label}-${position}`;
      lines.push({ ...entry, id: entryId, parentId });
      parentId = entryId;
    }
    writeFileSync(file, lines.map(line => JSON.stringify(line)).join("\n") + "\n" + (options.raw ?? ""));
    return { id, file };
  };
  const user = (text: string) => ({ type: "message", message: { role: "user", content: [{ type: "text", text }] } });
  const admission = (clientMessageId: string, id: string) => ({ type: "custom", customType: "rpc_client_message_admission", data: { clientMessageId, durableSessionId: id } });
  return {
    ui: write("ui", () => [{ type: "custom", customType: "omo-ui.origin", data: { createdBy: "omo-ui", surface: "desktop" } }, user("made in the app")]),
    tui: write("tui", () => [user("typed in the terminal")]),
    discord: write("discord", id => [admission("discord:1557276589203656765", id), user("from Discord")]),
    probe: write("probe", id => [admission("probe-owner:0190f0c0-0000-7000-8000-000000000099", id), user("probe")]),
    empty: write("empty", () => [{ type: "model_change", provider: "fake", modelId: "fake-1" }]),
    defective: write("defective", () => [user("damaged")], { raw: "{broken\n" + JSON.stringify({ type: "message", id: "x", parentId: "defective-0", message: { role: "assistant", content: [] } }) + "\n" }),
    temp: write("temp", () => [user("fixture")], { cwd: path.join(tmpdir(), "omo-ui-fixture-run", "project") }),
    child: write("child", () => [user("child task")], { header: { parentSession: path.join(folder, "parent.jsonl") } }),
  };
}

test("first launch imports only the sessions a person started, and never adds a workspace", async () => {
  const home = tempDir("import-home"), userData = tempDir("import-user");
  const seeds = seedStore(home);
  writeFileSync(path.join(userData, "preferences.json"), JSON.stringify({ locale: "en", onboardingCompleted: true, sessionImportCompleted: false, recentWorkspaces: ["/work/kept"] }));
  let running = await launchApp({ omo: "fake", fakeHome: home, userData });
  try {
    const dialog = running.page.getByTestId("session-import-dialog");
    await expect(dialog).toBeVisible();
    const row = (seed: Seed) => dialog.locator(`[data-testid="session-import-row"][data-session-id="${seed.id}"]`);
    await expect(row(seeds.ui!).getByRole("checkbox")).toBeChecked();
    await expect(row(seeds.tui!).getByRole("checkbox")).toBeChecked();
    for (const name of ["discord", "probe", "temp", "child"]) {
      await expect(row(seeds[name]!).getByRole("checkbox"), name).not.toBeChecked();
      await expect(row(seeds[name]!).getByRole("checkbox"), name).toBeEnabled();
    }
    await expect(row(seeds.defective!).getByRole("checkbox")).toBeDisabled();
    await expect(row(seeds.empty!)).toHaveCount(0);
    await expect(running.page.getByTestId("session-import-empty-count")).toContainText("1");
    await running.page.getByTestId("session-import-confirm").click();
    await expect(dialog).toHaveCount(0);
    await expect(threadRow(running.page, seeds.ui!.id)).toBeVisible();
    await expect(threadRow(running.page, seeds.tui!.id)).toBeVisible();
    await expect(threadRow(running.page, seeds.discord!.id)).toHaveCount(0);
    const stored = await running.page.evaluate(() => window.omo.getPreferences());
    expect([...stored.managedThreadIds].sort()).toEqual([seeds.ui!.id, seeds.tui!.id].sort());
    expect(stored.recentWorkspaces).toEqual(["/work/kept"]);
    expect(stored.sessionImportCompleted).toBe(true);
    await running.close();
    running = await launchApp({ omo: "fake", fakeHome: home, userData });
    await expect(running.page.getByTestId("app-frame")).toBeVisible();
    await expect(running.page.getByTestId("session-import-dialog")).toHaveCount(0);
  } finally { await running.close(); }
});

test("skipping imports nothing, and the import stays reachable from the native sessions dialog", async () => {
  const home = tempDir("import-skip-home"), userData = tempDir("import-skip-user");
  const seeds = seedStore(home);
  writeFileSync(path.join(userData, "preferences.json"), JSON.stringify({ locale: "en", onboardingCompleted: true, sessionImportCompleted: false }));
  const running = await launchApp({ omo: "fake", fakeHome: home, userData });
  try {
    await expect(running.page.getByTestId("session-import-dialog")).toBeVisible();
    await running.page.getByTestId("session-import-skip").click();
    await expect(running.page.getByTestId("session-import-dialog")).toHaveCount(0);
    const stored = await running.page.evaluate(() => window.omo.getPreferences());
    expect([stored.managedThreadIds, stored.sessionImportCompleted]).toEqual([[], true]);
    await openNativeSessions(running.page);
    await running.page.getByTestId("native-sessions-import").click();
    const dialog = running.page.getByTestId("session-import-dialog");
    await expect(dialog.locator(`[data-testid="session-import-row"][data-session-id="${seeds.tui!.id}"]`).getByRole("checkbox")).toBeChecked();
  } finally { await running.close(); }
});
async function seededSessions(home: string, ids: string[]): Promise<string> {
  const seedFile = path.join(home, "seed.json");
  writeFileSync(seedFile, JSON.stringify(ids.map(id => ({ id, cwd: tempDir("held-workspace"), name: `Session ${id.slice(-4)}` }))));
  return seedFile;
}

test("a session another omo process holds is marked in the sidebar and locks its composer with the holder named", async () => {
  const home = tempDir("held-home");
  const held = "0190f0c0-0000-7000-8000-00000000aaa1", stale = "0190f0c0-0000-7000-8000-00000000aaa2";
  const seedFile = await seededSessions(home, [held, stale]);
  // This test runner stands in for the foreign omo process: a real pid with its real creation time.
  const startedAtMs = (await processStartTimes([process.pid])).get(process.pid);
  expect(startedAtMs).toBeDefined();
  const record = (id: string, processStartedAtMs: number): void => {
    const directory = path.join(home, "sessions", "session-holders", id);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, `${process.pid}.json`), JSON.stringify({ pid: process.pid, bootAtMs: 1, processStartedAtMs, cwd: "P:\\elsewhere" }));
  };
  record(held, startedAtMs!);
  record(stale, startedAtMs! - 3_600_000);
  const running = await launchApp({
    omo: "fake", fakeHome: home, managed: [held, stale],
    extraEnv: { FAKE_OMO_SEED_THREADS: seedFile, FAKE_OMO_HELD: JSON.stringify({ [held]: [{ pid: process.pid, cwd: "P:\\elsewhere" }] }) },
  });
  try {
    const { page } = running;
    await expect(threadRow(page, held).getByTestId("thread-in-use")).toContainText("In use");
    await expect(threadRow(page, stale)).toBeVisible();
    await expect(threadRow(page, stale).getByTestId("thread-in-use")).toHaveCount(0);
    await threadRow(page, held).click();
    const input = page.getByTestId("composer-input");
    await expect(input).toHaveAttribute("data-thread-id", held);
    await input.fill("hello");
    await input.press("Enter");
    const banner = page.getByTestId("composer-held-banner");
    await expect(banner).toContainText(`This session is open in another omo process (pid ${process.pid}, P:\\elsewhere)`);
    await expect(input).toBeDisabled();
    await expect(page.getByTestId("notice-toast")).toHaveCount(0);
    await expect(page.getByTestId("composer-held-retry")).toBeVisible();
    await page.getByTestId("composer-held-retry").click();
    await expect(banner).toBeVisible();
    // The session of the stale record opens normally.
    await threadRow(page, stale).click();
    await expect(input).toHaveAttribute("data-thread-id", stale);
    await expect(input).toBeEnabled();
    await expect(banner).toHaveCount(0);
  } finally { await running.close(); }
});

test("Settings lists managed sessions that have no session file and removes only those entries", async () => {
  const home = tempDir("missing-home"), userData = tempDir("missing-user");
  const present = "0190f0c0-0000-7000-8000-00000000bbb1", gone = "0190f0c0-0000-7000-8000-00000000bbb2", goneToo = "0190f0c0-0000-7000-8000-00000000bbb3";
  const seedFile = await seededSessions(home, [present]);
  writeFileSync(path.join(userData, "preferences.json"), JSON.stringify({
    locale: "en", managedThreadIds: [present, gone, goneToo], pinnedThreadIds: [gone, present], threadParents: { [goneToo]: present },
  }));
  const running = await launchApp({ omo: "fake", fakeHome: home, userData, extraEnv: { FAKE_OMO_SEED_THREADS: seedFile } });
  try {
    const { page } = running;
    await page.getByTestId("open-settings").click();
    await page.getByTestId("settings-dialog").locator('[data-section="import"]').click();
    const card = page.getByTestId("settings-import-missing");
    await expect(card).toContainText("2 entries without a session file");
    await expect(card).toContainText(gone);
    await expect(card).not.toContainText(present);
    await page.getByTestId("settings-import-missing-remove").click();
    await expect(card).toHaveCount(0);
    const stored = await page.evaluate(() => window.omo.getPreferences());
    expect([stored.managedThreadIds, stored.pinnedThreadIds, stored.threadParents]).toEqual([[present], [present], {}]);
    expect(existsSync(path.join(home, "sessions", `${present}.jsonl`))).toBe(true);
  } finally { await running.close(); }
});
