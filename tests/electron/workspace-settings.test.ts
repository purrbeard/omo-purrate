import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspaceSettings } from "../../electron/workspace-settings";

// Resolved through the platform's path module so the fake file map keys match what the module joins
// (`C:\repo\app\.omo\settings.json` on Windows, `/repo/app/.omo/settings.json` elsewhere).
const ROOT = path.resolve("/repo/app");
const MISSING = path.resolve("/repo/missing");
const SETTINGS = path.join(ROOT, ".omo", "settings.json");

function harness(files: Record<string, string> = {}) {
  const written: Record<string, string> = {};
  const settings = createWorkspaceSettings({
    readFile: async (file) => {
      const text = files[file];
      if (text === undefined) {
        const error = new Error("ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return text;
    },
    writeFile: async (file, text) => {
      written[file] = text;
      files[file] = text;
    },
    mkdir: async () => undefined,
    statPath: async (target) => {
      if (target !== ROOT) throw new Error(`ENOENT: ${target}`);
      return { isDirectory: () => true };
    },
  });
  return { settings, written };
}

describe("createWorkspaceSettings", () => {
  it("defaults to full-access without a settings file", async () => {
    const { settings } = harness();
    await expect(settings.getPermissionPreset(ROOT)).resolves.toBe("full-access");
  });

  it("reads an existing preset", async () => {
    const { settings } = harness({ [SETTINGS]: '{\n  "permissionPreset": "workspace"\n}\n' });
    await expect(settings.getPermissionPreset(ROOT)).resolves.toBe("workspace");
  });

  it("treats an unknown preset value as full-access", async () => {
    const { settings } = harness({ [SETTINGS]: '{"permissionPreset": "yolo"}' });
    await expect(settings.getPermissionPreset(ROOT)).resolves.toBe("full-access");
  });

  it("creates the settings file with only the preset when absent", async () => {
    const { settings, written } = harness();
    await settings.setPermissionPreset(ROOT, "ask");
    expect(JSON.parse(written[SETTINGS] ?? "{}")).toEqual({ permissionPreset: "ask" });
    await expect(settings.getPermissionPreset(ROOT)).resolves.toBe("ask");
  });

  it("merges the preset into an existing settings file", async () => {
    const { settings, written } = harness({ [SETTINGS]: '{"defaultModel":"claude-opus-5-5"}' });
    await settings.setPermissionPreset(ROOT, "workspace");
    expect(JSON.parse(written[SETTINGS] ?? "{}")).toEqual({ defaultModel: "claude-opus-5-5", permissionPreset: "workspace" });
  });

  it("fails loud on invalid settings JSON", async () => {
    const { settings } = harness({ [SETTINGS]: "{oops" });
    await expect(settings.getPermissionPreset(ROOT)).rejects.toThrow("not valid JSON");
    await expect(settings.setPermissionPreset(ROOT, "ask")).rejects.toThrow("not valid JSON");
  });

  it("rejects invalid directories", async () => {
    const { settings } = harness();
    await expect(settings.setPermissionPreset(path.join("repo", "app"), "ask")).rejects.toThrow("absolute");
    await expect(settings.setPermissionPreset(MISSING, "ask")).rejects.toThrow("does not exist");
  });
});
