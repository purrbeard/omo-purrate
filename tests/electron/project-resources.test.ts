import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readProjectResources } from "../../electron/omo/project-resources";

async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), "omo-project-resources-"));
  const agent = path.join(root, "agent");
  const cwd = path.join(root, "parent", "project");
  await fs.mkdir(agent, { recursive: true });
  await fs.mkdir(path.join(cwd, ".omo"), { recursive: true });
  const canonical = await fs.realpath(cwd);
  return {
    agent, cwd: canonical, parent: path.dirname(canonical),
    trust: path.join(agent, "trust.json"),
    global: path.join(agent, "settings.json"),
    project: path.join(canonical, ".omo", "settings.json"),
  };
}

async function put(file: string, value: unknown) {
  await fs.writeFile(file, JSON.stringify(value));
}

async function hash(file: string) {
  return createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

describe("readProjectResources", () => {
  it("reads only declarations and direct trust without changing files or installing", async () => {
    const f = await fixture();
    await put(f.trust, { [f.parent]: true, [f.cwd]: false });
    await put(f.global, {
      defaultProjectTrust: "always", packages: ["npm:global"],
      extensions: ["./global.ts"], secret: "must-not-appear",
    });
    await put(f.project, {
      packages: [{ source: "npm:project", skills: ["one"], secret: "must-not-appear" }],
      skills: ["./skills"], prompts: ["!private"], themes: ["./theme"],
    });
    const files = [f.trust, f.global, f.project];
    const before = await Promise.all(files.map(hash));
    const result = await readProjectResources(f.agent, f.cwd);
    expect(result.trust).toEqual({
      kind: "direct", trusted: false, path: f.trust,
      matchedDirectory: f.cwd, defaultValue: null,
    });
    expect(result.sources[0]?.declarations.packages).toEqual(["npm:global"]);
    expect(result.sources[1]?.declarations.packages).toEqual([{ source: "npm:project", skills: ["one"] }]);
    expect(result.sources[1]?.declarations.skills).toEqual(["./skills"]);
    expect(JSON.stringify(result)).not.toContain("must-not-appear");
    expect(await Promise.all(files.map(hash))).toEqual(before);
    expect((await fs.readdir(f.agent)).sort()).toEqual(["settings.json", "trust.json"]);
    expect(await fs.readdir(path.dirname(f.project))).toEqual(["settings.json"]);
  });

  it("uses the closest ancestor, including case-insensitive keys on Windows", async () => {
    const f = await fixture();
    const parent = process.platform === "win32" ? f.parent.toUpperCase() : f.parent;
    await put(f.trust, { [path.dirname(f.parent)]: false, [parent]: true });
    const result = await readProjectResources(f.agent, f.cwd);
    expect(result.trust).toEqual({
      kind: "ancestor", trusted: true, path: f.trust,
      matchedDirectory: f.parent, defaultValue: null,
    });
  });

  it.each([
    [undefined, "ask", null], ["ask", "ask", null],
    ["never", "never", false], ["always", "always", true],
  ])("uses the non-interactive default for %s", async (setting, expected, trusted) => {
    const f = await fixture();
    await put(f.global, setting === undefined ? {} : { defaultProjectTrust: setting });
    const result = await readProjectResources(f.agent, f.cwd);
    expect(result.trust).toMatchObject({ kind: "default", defaultValue: expected, trusted, path: f.global });
    expect(result.sources[1]?.exists).toBe(false);
  });

  it.each([
    ["trust", "{bad"], ["trust", JSON.stringify({ relative: true })],
    ["trust", JSON.stringify({ "/absolute": "yes" })],
    ["global", "[]"], ["global", JSON.stringify({ defaultProjectTrust: "unknown" })],
    ["project", JSON.stringify({ packages: [{ source: "x", skills: [1] }] })],
    ["project", JSON.stringify({ extensions: "not-an-array" })],
  ])("rejects malformed %s without changing fixture files", async (which, content) => {
    const f = await fixture();
    const file = which === "trust" ? f.trust : which === "global" ? f.global : f.project;
    await fs.writeFile(file, content);
    const before = await hash(file);
    await expect(readProjectResources(f.agent, f.cwd)).rejects.toThrow();
    expect(await hash(file)).toBe(before);
    expect((await fs.readdir(f.agent)).sort()).toEqual(which === "project" ? [] : [path.basename(file)]);
    expect(await fs.readdir(path.dirname(f.project))).toEqual(which === "project" ? ["settings.json"] : []);
  });
});
