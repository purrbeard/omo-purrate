import { spawn } from "node:child_process";
import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createNativeCatalog } from "../../electron/workbench/native-catalog";

const binary = fileURLToPath(new URL("../fixtures/fake-omo.mjs", import.meta.url));
const environment = () => Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));

describe("native catalog", () => {
  it("reads a separate RPC binary, maps valid rows, caches and coalesces requests", async () => {
    const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), "omo-native-catalog-")));
    let spawned = 0;
    const load = createNativeCatalog({
      supervisor: { getStatus: () => ({ omo: { path: binary } }), getLoginEnv: async () => ({ ...environment(), PI_SESSION_ID: "secret", SENPI_BINDING: "secret", OMO_SESSION: "secret" }) },
      spawnImpl: (command, args, options) => {
        spawned += 1;
        expect(options.cwd).toBe(cwd);
        expect(options.env?.["PI_SESSION_ID"]).toBeUndefined();
        expect(options.env?.["SENPI_BINDING"]).toBeUndefined();
        expect(options.env?.["OMO_SESSION"]).toBeUndefined();
        expect(args.slice(-4)).toEqual(["--mode", "rpc", "--no-session", "--offline"]);
        if (process.platform === "win32") {
          expect(command).toBe(process.execPath);
          expect(options.env?.["ELECTRON_RUN_AS_NODE"]).toBe("1");
          return spawn(command, args, options);
        }
        return spawn(process.execPath, [binary, ...args], options);
      },
    });
    const [first, concurrent] = await Promise.all([load(cwd), load(path.join(cwd, "."), true)]);
    expect(concurrent).toBe(first);
    expect(first.error).toBeNull();
    expect(first.commands).toEqual([
      { name: "todo", description: "Track work", source: "extension", syntax: "slash" },
      { name: "review", description: "", source: "prompt", syntax: "slash" },
      { name: "skill:ulw-loop", description: "Run a loop", source: "skill", syntax: "dollar" },
    ]);
    expect(first.contextWindows["fake/fake-model"]).toBe(128000);
    expect(first.contextWindows["fake/alpha"]).toBe(128000);
    expect(first.contextWindows["fake/gpt-6-astra"]).toBe(128000);
    expect(first.contextWindows["fake/invalid"]).toBeUndefined();
    expect(first.contextWindows["fake/fraction"]).toBeUndefined();
    expect(await load(cwd)).toBe(first);
    expect(spawned).toBe(1);
    expect((await load(cwd, true)).error).toBeNull();
    expect(spawned).toBe(2);
  });

  it("returns errors rather than throwing for invalid workspaces, unavailable binaries and spawn failures", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "omo-native-failure-"));
    const unavailable = createNativeCatalog({ supervisor: { getStatus: () => ({ omo: null }), getLoginEnv: async () => environment() } });
    expect(await unavailable(".")).toMatchObject({ commands: [], contextWindows: {}, error: expect.stringMatching(/absolute/) });
    expect((await unavailable(cwd)).error).toMatch(/unavailable/);
    const broken = createNativeCatalog({ supervisor: { getStatus: () => ({ omo: { path: path.join(cwd, "missing.exe") } }), getLoginEnv: async () => environment() } });
    expect(await broken(cwd)).toMatchObject({ commands: [], contextWindows: {}, error: expect.stringMatching(/ENOENT/) });
  });
});
