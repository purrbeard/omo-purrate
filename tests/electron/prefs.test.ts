import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, PreferencesStore } from "../../electron/prefs";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "omo-ui-prefs-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("PreferencesStore", () => {
  it("backfills managed thread ids and persists unique nonempty ids without changing other preferences", async () => {
    await writeFile(path.join(dir, "preferences.json"), JSON.stringify({ theme: "dark", threadParents: { child: "main" } }));
    const prefs = new PreferencesStore(dir);
    expect(prefs.get().managedThreadIds).toEqual([]);
    const managedThreadIds = Array.from({ length: 201 }, (_, index) => `thread-${index}`);
    expect(prefs.set({ managedThreadIds: ["", null, 42, managedThreadIds[0], ...managedThreadIds] }).managedThreadIds).toEqual(managedThreadIds);
    expect(prefs.set({ locale: "ko", managedThreadIds: null })).toMatchObject({
      managedThreadIds, theme: "dark", threadParents: { child: "main" }, locale: "ko",
    });
    expect(new PreferencesStore(dir).get()).toMatchObject({
      managedThreadIds, theme: "dark", threadParents: { child: "main" }, locale: "ko",
    });
    expect(prefs.set({ managedThreadIds: [] }).managedThreadIds).toEqual([]);
  });
  it("persists explicit related-session ownership without changing other preferences", () => {
    const prefs = new PreferencesStore(dir);
    prefs.set({ threadParents: { child: "main", self: "self", invalid: 2 }, settledThreads: ["old"] });
    expect(new PreferencesStore(dir).get()).toMatchObject({ threadParents: { child: "main" }, settledThreads: ["old"] });
  });
  it("persists explicit session origins and discards invalid classifications", () => {
    const prefs = new PreferencesStore(dir);
    const threadOrigins = { probe: "agent", main: "user", discord: "dori", unproven: "unknown" };
    prefs.set({ threadOrigins: { ...threadOrigins, invalid: "other" }, theme: "dark" });
    expect(new PreferencesStore(dir).get()).toMatchObject({ threadOrigins, theme: "dark" });
    expect(prefs.set({ threadOrigins: null }).threadOrigins).toEqual(threadOrigins);
  });
  it("persists UI creator evidence by thread ID separately from manual origins", () => {
    const prefs = new PreferencesStore(dir);
    const threadCreators = { main: { origin: "user", source: "ui-new-session" } };
    prefs.set({ threadCreators, threadOrigins: { main: "unknown" }, threadParents: { child: "main" }, theme: "dark" });
    expect(prefs.set({ locale: "ko" })).toMatchObject({ threadCreators, threadOrigins: { main: "unknown" } });
    expect(new PreferencesStore(dir).get()).toMatchObject({
      threadCreators, threadOrigins: { main: "unknown" }, threadParents: { child: "main" }, theme: "dark", locale: "ko",
    });
  });
  it("validates creator evidence at the IPC boundary and stores only its typed fields", () => {
    const prefs = new PreferencesStore(dir);
    const evidence = { origin: "user", source: "ui-new-session" };
    expect(prefs.set({ threadCreators: {
      main: { ...evidence, extra: "ignored" },
      "": evidence, invalid: null, missingSource: { origin: "user" }, missingOrigin: { source: "ui-new-session" },
      agent: { origin: "agent", source: "ui-new-session" }, dori: { origin: "dori", source: "ui-new-session" },
      unknown: { origin: "unknown", source: "ui-new-session" }, unsupported: { origin: "user", source: "title" },
    } }).threadCreators).toEqual({ main: evidence });
    for (const threadCreators of [null, [], "invalid", 42]) {
      expect(prefs.set({ threadCreators }).threadCreators).toEqual({ main: evidence });
    }
    expect(new PreferencesStore(dir).get().threadCreators).toEqual({ main: evidence });
  });
  it("backfills no creator evidence for old preferences and preserves existing manual origins", async () => {
    await writeFile(path.join(dir, "preferences.json"), JSON.stringify({ threadOrigins: { main: "user", probe: "agent" } }));
    expect(new PreferencesStore(dir).get()).toMatchObject({ threadOrigins: { main: "user", probe: "agent" }, threadCreators: {} });
  });
  it("persists palette independently of color scheme and rejects unknown palettes", () => {
    const prefs = new PreferencesStore(dir);
    expect(prefs.get().palette).toBe("omo");
    prefs.set({ palette: "sbd", theme: "dark" });
    expect(prefs.set({ palette: "unknown" })).toMatchObject({ palette: "sbd", theme: "dark" });
    expect(new PreferencesStore(dir).get()).toMatchObject({ palette: "sbd", theme: "dark" });
    expect(prefs.set({ theme: "light" })).toMatchObject({ palette: "sbd", theme: "light" });
  });
  it("returns defaults when no file exists", () => {
    expect(new PreferencesStore(dir).get()).toEqual(DEFAULT_PREFERENCES);
  });

  it("returns defaults when the file is corrupt", async () => {
    await writeFile(path.join(dir, "preferences.json"), "{nope");
    expect(new PreferencesStore(dir).get()).toEqual(DEFAULT_PREFERENCES);
  });

  it("defaults auto-update on for old preferences and persists only boolean choices", async () => {
    await writeFile(path.join(dir, "preferences.json"), JSON.stringify({ theme: "dark" }));
    const store = new PreferencesStore(dir);
    expect(store.get().omoAutoUpdate).toBe(true);
    expect(store.set({ omoAutoUpdate: false }).omoAutoUpdate).toBe(false);
    expect(store.set({ omoAutoUpdate: "true" }).omoAutoUpdate).toBe(false);
    expect(new PreferencesStore(dir).get().omoAutoUpdate).toBe(false);
    expect(store.set({ omoAutoUpdate: true }).omoAutoUpdate).toBe(true);
  });

  it("keeps the current value for invalid fields", () => {
    const store = new PreferencesStore(dir);
    store.set({ theme: "dark", modelId: "gpt" });
    const next = store.set({ theme: "neon", locale: 42, modelId: "", lastWorkspace: 7 });
    expect(next).toEqual({ ...DEFAULT_PREFERENCES, theme: "dark", modelId: "gpt" });
  });

  it("validates and persists profiles without requiring them in old preferences", async () => {
    await writeFile(path.join(dir, "preferences.json"), JSON.stringify({ modelId: "old-model" }));
    const store = new PreferencesStore(dir);
    expect(store.get().modelProfile).toBeUndefined();
    expect(store.set({ modelProfile: "geeky-heavy" }).modelProfile).toBe("geeky-heavy");
    expect(store.set({ modelProfile: "invalid" }).modelProfile).toBe("geeky-heavy");
    expect(new PreferencesStore(dir).get().modelProfile).toBe("geeky-heavy");
    expect(store.set({ modelProfile: null }).modelProfile).toBeNull();
  });

  it("deduplicates recent workspaces and keeps at most 10", () => {
    const store = new PreferencesStore(dir);
    const many = Array.from({ length: 12 }, (_, index) => `/w/${index}`);
    const next = store.set({ recentWorkspaces: ["/w/0", "/w/0", "", 3, ...many] });
    expect(next.recentWorkspaces).toEqual(many.slice(0, 10));
  });

  it("persists each profile's model independently and restores Automatic by omitting an entry", () => {
    const store = new PreferencesStore(dir);
    expect(store.get().profileModels).toBeUndefined();
    const profileModels = {
      "daily-normal": "opus",
      "daily-heavy": "fable",
      "geeky-normal": "sol",
      "geeky-heavy": "astra",
    };
    expect(store.set({ profileModels }).profileModels).toEqual(profileModels);
    expect(store.set({ theme: "dark" }).profileModels).toEqual(profileModels);
    expect(new PreferencesStore(dir).get().profileModels).toEqual(profileModels);
    expect(store.set({ profileModels: { "daily-heavy": "custom" } }).profileModels).toEqual({ "daily-heavy": "custom" });
    expect(new PreferencesStore(dir).get().profileModels).toEqual({ "daily-heavy": "custom" });
    expect(store.set({ profileModels: {} }).profileModels).toEqual({});
    expect(new PreferencesStore(dir).get().profileModels).toEqual({});
  });

  it("rejects invalid profile-model maps and entries at the IPC boundary", () => {
    const store = new PreferencesStore(dir);
    store.set({ profileModels: { "daily-heavy": "custom" } });
    for (const profileModels of [null, [], "custom", 42]) {
      expect(store.set({ profileModels }).profileModels).toEqual({ "daily-heavy": "custom" });
    }
    expect(store.set({ profileModels: {
      "daily-heavy": "  ", "daily-normal": 42, "geeky-normal": null,
      "geeky-heavy": "astra", unknown: "custom",
    } }).profileModels).toEqual({ "daily-heavy": "custom", "geeky-heavy": "astra" });
    expect(store.set({ profileModels: { "daily-heavy": "", "geeky-heavy": false } }).profileModels).toEqual({
      "daily-heavy": "custom", "geeky-heavy": "astra",
    });
  });

  it("defaults onboarding to incomplete and completes old preferences that already used a workspace", async () => {
    expect(new PreferencesStore(dir).get().onboardingCompleted).toBe(false);
    await writeFile(path.join(dir, "preferences.json"), JSON.stringify({ recentWorkspaces: ["/w/0"] }));
    expect(new PreferencesStore(dir).get().onboardingCompleted).toBe(true);
    await writeFile(path.join(dir, "preferences.json"), JSON.stringify({ lastWorkspace: "/repo", recentWorkspaces: [] }));
    expect(new PreferencesStore(dir).get().onboardingCompleted).toBe(true);
    const store = new PreferencesStore(dir);
    expect(store.set({ onboardingCompleted: false }).onboardingCompleted).toBe(false);
    expect(store.set({ onboardingCompleted: "yes" }).onboardingCompleted).toBe(false);
    expect(store.set({ onboardingCompleted: true }).onboardingCompleted).toBe(true);
    expect(new PreferencesStore(dir).get().onboardingCompleted).toBe(true);
  });

  it("defaults the behaviour fields and backfills old preference files", async () => {
    await writeFile(path.join(dir, "preferences.json"), JSON.stringify({ theme: "dark" }));
    const store = new PreferencesStore(dir);
    expect(store.get()).toMatchObject({
      threadNotifications: "background",
      inAppNotifications: true,
      timeFormat: "system",
      autoSettle: true,
      autoSettleDays: 3,
      settledThreads: [],
      unsettledThreads: [],
    });
  });

  it("validates thread notification and time format choices", () => {
    const store = new PreferencesStore(dir);
    expect(store.set({ threadNotifications: "always" }).threadNotifications).toBe("always");
    expect(store.set({ threadNotifications: "sometimes" }).threadNotifications).toBe("always");
    expect(store.set({ threadNotifications: 7 }).threadNotifications).toBe("always");
    expect(store.set({ timeFormat: "24h" }).timeFormat).toBe("24h");
    expect(store.set({ timeFormat: "24" }).timeFormat).toBe("24h");
    expect(store.set({ inAppNotifications: false }).inAppNotifications).toBe(false);
    expect(store.set({ inAppNotifications: "no" }).inAppNotifications).toBe(false);
    expect(store.set({ autoSettle: false }).autoSettle).toBe(false);
    expect(store.set({ autoSettle: 0 }).autoSettle).toBe(false);
  });

  it("clamps auto-settle days into 1..365 and ignores non-numbers", () => {
    const store = new PreferencesStore(dir);
    expect(store.set({ autoSettleDays: 0 }).autoSettleDays).toBe(1);
    expect(store.set({ autoSettleDays: -5 }).autoSettleDays).toBe(1);
    expect(store.set({ autoSettleDays: 400 }).autoSettleDays).toBe(365);
    expect(store.set({ autoSettleDays: 3.6 }).autoSettleDays).toBe(4);
    expect(store.set({ autoSettleDays: "7" }).autoSettleDays).toBe(4);
    expect(new PreferencesStore(dir).get().autoSettleDays).toBe(4);
  });

  it("bounds and deduplicates settled and unsettled thread ids", () => {
    const store = new PreferencesStore(dir);
    const many = Array.from({ length: 205 }, (_, index) => `t${index}`);
    const next = store.set({ settledThreads: ["a", "a", "", 4, ...many] });
    expect(next.settledThreads).toEqual(many.slice(-200));
    expect(store.set({ settledThreads: "x" }).settledThreads).toEqual(many.slice(-200));
    expect(store.set({ unsettledThreads: ["u", "u"] }).unsettledThreads).toEqual(["u"]);
  });

  it("persists atomically so a new store reads the saved values", async () => {
    new PreferencesStore(dir).set({ theme: "light", locale: "ko", lastWorkspace: "/repo", modelId: null });
    expect(await readdir(dir)).toEqual(["preferences.json"]);
    expect(JSON.parse(await readFile(path.join(dir, "preferences.json"), "utf8"))).toMatchObject({ theme: "light", locale: "ko" });
    expect(new PreferencesStore(dir).get()).toEqual({
      ...DEFAULT_PREFERENCES,
      theme: "light",
      locale: "ko",
      lastWorkspace: "/repo",
      onboardingCompleted: true,
    });
  });
});
