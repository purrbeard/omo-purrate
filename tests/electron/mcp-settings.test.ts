import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadMcpSettings, saveMcpSettings } from "../../electron/omo/mcp-settings";
import type { McpSaveInput, McpScope } from "../../shared/mcp-settings";

async function save(scope: McpScope, agent: string, cwd: string, input: Omit<McpSaveInput, "revision" | "mode">) {
  const loaded = await loadMcpSettings(scope, agent, cwd);
  return saveMcpSettings(scope, agent, cwd, { ...input, revision: loaded.revision, mode: loaded.servers.some(server => server.name === input.name) ? "update" : "create" });
}

async function fixture() {
  // The fixture is retained; this suite does not delete files.
  const root = await fs.mkdtemp(path.join(tmpdir(), "omo-mcp-editor-"));
  const agent = path.join(root, "agent");
  const cwd = path.join(root, "project");
  await fs.mkdir(agent);
  await fs.mkdir(cwd);
  return { agent, cwd, globalFile: path.join(agent, "mcp.json"),
    projectFile: path.join(cwd, ".omo", "mcp.json") };
}

describe("local MCP editor", () => {
  it("preserves reference objects and unknown fields while exposing only metadata", async () => {
    const f = await fixture();
    const original = {
      settings: { toolPrefix: "custom" },
      future: { keep: true },
      mcpServers: {
        local: {
          command: "private-command",
          args: [{ $env: "TOKEN" }, { $concat: ["prefix", { $file: "private-file" }] }],
          env: { TOKEN: { $env: "TOKEN" } },
          headers: { Authorization: { $file: "private-header" } },
          future: { keep: true },
        },
      },
    };
    const text = `${JSON.stringify(original)}\n`;
    await fs.writeFile(f.globalFile, text);
    expect((await loadMcpSettings("global", f.agent, f.cwd)).servers)
      .toEqual([{ name: "local", type: "stdio", enabled: true }]);
    await save("global", f.agent, f.cwd,
      { name: "local", type: "stdio", enabled: false });
    const updated: unknown = JSON.parse(await fs.readFile(f.globalFile, "utf8"));
    expect(updated).toEqual({
      ...original,
      mcpServers: { local: { ...original.mcpServers.local, type: "stdio", enabled: false } },
    });
    const backups = (await fs.readdir(f.agent)).filter((name) => name.endsWith(".bak"));
    expect(backups).toHaveLength(1);
    const backup = backups[0];
    if (backup === undefined) throw new Error("Missing backup");
    expect(await fs.readFile(path.join(f.agent, backup), "utf8")).toBe(text);
    await save("global", f.agent, f.cwd,
      { name: "local", type: "stdio", enabled: true, command: "replacement" });
    expect((await fs.readdir(f.agent)).filter((name) => name.endsWith(".bak"))).toHaveLength(2);
    await save("global", f.agent, f.cwd, { name: "local", type: "stdio", enabled: true, remove: true });
    expect((await loadMcpSettings("global", f.agent, f.cwd)).servers).toEqual([]);
    expect((await fs.readdir(f.agent)).filter(name => name.endsWith(".bak"))).toHaveLength(3);
  });

  it("isolates project and global files and explicitly replaces arguments", async () => {
    const f = await fixture();
    await save("global", f.agent, f.cwd,
      { name: "global", type: "http", enabled: false, url: "https://example.test/mcp" });
    const globalBefore = await fs.readFile(f.globalFile, "utf8");
    await save("project", f.agent, f.cwd,
      { name: "project", type: "stdio", enabled: false, command: "node", args: ["server"] });
    await save("project", f.agent, f.cwd,
      { name: "project", type: "stdio", enabled: true, args: [] });
    expect(await fs.readFile(f.globalFile, "utf8")).toBe(globalBefore);
    expect(JSON.parse(await fs.readFile(f.projectFile, "utf8"))).toEqual({
      mcpServers: { project: { type: "stdio", enabled: true, command: "node", args: [] } },
    });
  });

  it("rejects invalid input and malformed existing JSON before writing", async () => {
    const f = await fixture();
    const original = '{"mcpServers":{"keep":{"command":"node"}}}\n';
    await fs.writeFile(f.globalFile, original);
    await expect(save("global", f.agent, f.cwd,
      { name: "bad", type: "http", enabled: true, url: "https://user:secret@example.test" }))
      .rejects.toThrow("Could not save MCP configuration.");
    await expect(saveMcpSettings("global", f.agent, f.cwd,
      { name: "bad", type: "stdio", enabled: true, command: "node", revision: "unused", mode: "create", env: { TOKEN: "secret" } }))
      .rejects.toThrow();
    expect(await fs.readFile(f.globalFile, "utf8")).toBe(original);
    expect(await fs.readdir(f.agent)).toEqual(["mcp.json"]);
    await fs.writeFile(f.globalFile, "{invalid");
    await expect(saveMcpSettings("global", f.agent, f.cwd,
      { name: "new", type: "stdio", enabled: false, command: "node", revision: "unused", mode: "create" })).rejects.toThrow();
    expect(await fs.readFile(f.globalFile, "utf8")).toBe("{invalid");
    expect(await fs.readdir(f.agent)).toEqual(["mcp.json"]);
  });

  it("refuses stale edits and exclusions and rejects creation over an existing name", async () => {
    const f = await fixture();
    await save("global", f.agent, f.cwd, { name: "same", type: "stdio", command: "old", enabled: false });
    const before = await loadMcpSettings("global", f.agent, f.cwd);
    const changed = '{"mcpServers":{"same":{"type":"stdio","command":"external","enabled":true}}}\n';
    await fs.writeFile(f.globalFile, changed);
    for (const remove of [false, true]) await expect(saveMcpSettings("global", f.agent, f.cwd, {
      name: "same", type: "stdio", command: "stale", enabled: false, remove, revision: before.revision, mode: "update",
    })).rejects.toThrow();
    const current = await loadMcpSettings("global", f.agent, f.cwd);
    await expect(saveMcpSettings("global", f.agent, f.cwd, { name: "same", type: "stdio", command: "collision", enabled: false, revision: current.revision, mode: "create" })).rejects.toThrow();
    expect(await fs.readFile(f.globalFile, "utf8")).toBe(changed);
    expect(await fs.readdir(f.agent)).toEqual(["mcp.json"]);
  });
});
