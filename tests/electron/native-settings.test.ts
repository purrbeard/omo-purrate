import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSON5 from "json5";
import { describe, expect, it } from "vitest";
import { readNativeSettings, saveNativeSettings } from "../../electron/omo/native-settings";

async function fixture(original: string) {
  // Fixtures remain in the OS temp directory; this suite deletes nothing.
  const root = await mkdtemp(path.join(tmpdir(), "omo-native-settings-"));
  const agent = path.join(root, "agent");
  const project = path.join(root, "project");
  await mkdir(agent);
  await mkdir(path.join(project, ".omo"), { recursive: true });
  const file = path.join(agent, "settings.json");
  await writeFile(file, original);
  return { agent, project, file };
}

describe("native settings", () => {
  it("preserves comments and unrelated values and creates an exact backup", async () => {
    const original = '{\n  // keep this comment\n  "private": "secret",\n  "compaction": {\n    // keep this too\n    "future": true,\n    "modelOverrides": {"local/model": {"keepRecentTokens": 10, "future": 7}}\n  }\n}\n';
    const f = await fixture(original);
    const before = await readNativeSettings(f.agent, "global");
    expect(JSON.stringify(before)).not.toContain("secret");
    const after = await saveNativeSettings(f.agent, {
      scope: "global",
      revision: before.revision,
      values: { compaction: { modelOverrides: { "local/model": { reserveTokens: 12 } } } },
    });
    const saved = await readFile(f.file, "utf8");
    expect(saved).toContain("// keep this comment");
    expect(saved).toContain("// keep this too");
    const parsed = JSON5.parse(saved);
    expect(parsed.private).toBe("secret");
    expect(parsed.compaction.future).toBe(true);
    expect(parsed.compaction.modelOverrides["local/model"]).toEqual({ keepRecentTokens: 10, future: 7, reserveTokens: 12 });
    expect(after.values.compaction).toEqual({ modelOverrides: { "local/model": { keepRecentTokens: 10, reserveTokens: 12 } } });
    const backups = (await readdir(f.agent)).filter((name) => name.endsWith(".bak"));
    expect(backups).toHaveLength(1);
    const backup = backups[0];
    if (backup === undefined) throw new Error("Backup missing.");
    expect(await readFile(path.join(f.agent, backup), "utf8")).toBe(original);
  });

  it("rejects invalid values before any write", async () => {
    const original = '{"compaction":{"reserveTokens":10}}\n';
    const f = await fixture(original);
    const before = await readNativeSettings(f.agent, "global");
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(saveNativeSettings(f.agent, {
        scope: "global", revision: before.revision, values: { compaction: { reserveTokens: value } },
      })).rejects.toThrow();
    }
    expect(await readFile(f.file, "utf8")).toBe(original);
    expect(await readdir(f.agent)).toEqual(["settings.json"]);
  });

  it("rejects stale revisions without replacing external changes", async () => {
    const f = await fixture('{"defaultModel":"old"}\n');
    const before = await readNativeSettings(f.agent, "global");
    const external = '{"defaultModel":"external"}\n';
    await writeFile(f.file, external);
    await expect(saveNativeSettings(f.agent, {
      scope: "global", revision: before.revision, values: { defaultModel: "new" },
    })).rejects.toThrow();
    expect(await readFile(f.file, "utf8")).toBe(external);
    expect(await readdir(f.agent)).toEqual(["settings.json"]);
  });

  it("serializes same-directory saves and rejects a stale second snapshot", async () => {
    const f = await fixture('{"defaultModel":"old"}\n');
    const before = await readNativeSettings(f.agent, "global");
    const first = saveNativeSettings(f.agent, { scope: "global", revision: before.revision, values: { defaultModel: "first" } });
    const second = saveNativeSettings(f.agent, { scope: "global", revision: before.revision, values: { defaultModel: "second" } });
    const results = await Promise.allSettled([first, second]);
    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]?.status).toBe("rejected");
    expect(JSON5.parse(await readFile(f.file, "utf8")).defaultModel).toBe("first");
  });

  it("prefers JSONC and rejects a snapshot if a preferred file appears", async () => {
    const f = await fixture('{"defaultModel":"json"}\n');
    const before = await readNativeSettings(f.agent, "global");
    const jsonc = path.join(f.agent, "settings.jsonc");
    await writeFile(jsonc, '// preferred\n{"defaultModel":"jsonc"}\n');
    await expect(saveNativeSettings(f.agent, {
      scope: "global", revision: before.revision, values: { defaultModel: "new" },
    })).rejects.toThrow();
    const current = await readNativeSettings(f.agent, "global");
    expect(current.configPath).toBe(jsonc);
    expect(current.values.defaultModel).toBe("jsonc");
    expect(await readFile(f.file, "utf8")).toBe('{"defaultModel":"json"}\n');
    expect(await readFile(jsonc, "utf8")).toBe('// preferred\n{"defaultModel":"jsonc"}\n');
  });

  it("writes project settings under .omo without changing global settings", async () => {
    const original = '{"defaultModel":"global"}\n';
    const f = await fixture(original);
    const before = await readNativeSettings(f.agent, "project", f.project);
    await saveNativeSettings(f.agent, {
      scope: "project", revision: before.revision, values: { terminal: { notify: "off" } },
    }, f.project);
    const projectFile = path.join(f.project, ".omo", "settings.json");
    expect(JSON5.parse(await readFile(projectFile, "utf8")).terminal.notify).toBe("off");
    expect(await readFile(f.file, "utf8")).toBe(original);
  });
});
