import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PreferencesStore } from "../../electron/prefs";
import { PROJECT_NAME_MAX, sanitizeProjectSettings } from "../../shared/project-settings";
import { findProjectSetting, patchProjectSetting, projectDisplayName } from "../../src/ui/projects/project-style";

describe("sanitizeProjectSettings", () => {
  it("keeps only allowed icons and colors, trims names and drops names over the limit and empty entries", () => {
    const result = sanitizeProjectSettings({
      "C:/a": { name: "  Alpha  ", icon: "rocket", color: "blue", extra: 1 },
      "C:/b": { name: "x".repeat(PROJECT_NAME_MAX + 1), icon: "not-an-icon", color: "teal" },
      "C:/c": { name: "x".repeat(PROJECT_NAME_MAX) },
      "": { name: "no key" },
      "C:/d": "nope",
    }, {});
    expect(result).toEqual({ "C:/a": { name: "Alpha", icon: "rocket", color: "blue" }, "C:/c": { name: "x".repeat(PROJECT_NAME_MAX) } });
  });

  it("keeps the current value for anything that is not an object", () => {
    const current = { "C:/a": { name: "Alpha" } };
    expect(sanitizeProjectSettings(null, current)).toBe(current);
    expect(sanitizeProjectSettings([1], current)).toBe(current);
  });
});

describe("project setting helpers", () => {
  it("matches a directory regardless of separator and case on Windows paths", () => {
    const settings = { "C:\\Work\\App": { name: "App" } };
    expect(findProjectSetting(settings, "c:/work/app/")?.key).toBe("C:\\Work\\App");
    expect(projectDisplayName(settings, "C:/work/app")).toBe("App");
    expect(projectDisplayName(settings, "C:/work/other")).toBe("other");
  });

  it("patches one field, clears with undefined and drops an emptied entry under the existing key", () => {
    const base = { "C:/Work": { name: "W", icon: "star" } };
    const patched = patchProjectSetting(base, "c:/work", { color: "red" });
    expect(patched).toEqual({ "C:/Work": { name: "W", icon: "star", color: "red" } });
    expect(patchProjectSetting(patched, "C:/Work", { name: undefined, icon: undefined, color: undefined })).toEqual({});
  });
});

describe("PreferencesStore projectSettings", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "omo-ui-projects-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("defaults to empty, validates on set and survives a reload", () => {
    const store = new PreferencesStore(dir);
    expect(store.get().projectSettings).toEqual({});
    expect(store.set({ projectSettings: { "C:/a": { name: "A", icon: "bug", color: "pink" }, "C:/b": { icon: "zzz" } } }).projectSettings)
      .toEqual({ "C:/a": { name: "A", icon: "bug", color: "pink" } });
    expect(store.set({ projectSettings: "bad" }).projectSettings).toEqual({ "C:/a": { name: "A", icon: "bug", color: "pink" } });
    expect(store.set({ locale: "ko" }).projectSettings).toEqual({ "C:/a": { name: "A", icon: "bug", color: "pink" } });
    expect(new PreferencesStore(dir).get().projectSettings).toEqual({ "C:/a": { name: "A", icon: "bug", color: "pink" } });
  });
});
