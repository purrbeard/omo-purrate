import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OMO_INSTALL_SCRIPT_URL } from "../../shared/ipc";
import type { OmoBinary, OmoUpdateStatus } from "../../shared/ipc";
import { AppServerClient } from "../../electron/omo/app-server-client";
import type { SpawnImpl } from "../../electron/omo/app-server-client";
import { OmoSupervisor } from "../../electron/omo/supervisor";
import { autoUpdateOmo, compareVersions, runUpdateCommand } from "../../electron/omo/updater";
import type { UpdateCommand, UpdateCommandRunner } from "../../electron/omo/updater";

const binary: OmoBinary = { path: "/fake/bin/omo", version: "5.1.4", source: "local-bin" };
const available = "omo 5.1.5 is available (running 5.1.4). Replace this binary with:\nnot executable";
const fixture = path.join(__dirname, "fixtures", "update-omo.mjs");
const dirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("compareVersions", () => {
  it.each([
    ["5.1.5", "5.1.4", 1], ["5.1.10", "5.1.9", 1], ["6.0.0", "5.99.99", 1],
    ["5.1.4", "5.1.4", 0], ["5.1.3", "5.1.4", -1],
    ["5.1.4", "5.1.4-beta.9", 1], ["5.1.4-beta.10", "5.1.4-beta.9", 1],
    ["5.1.4-beta", "5.1.4-beta.1", -1], ["5.1.4-1", "5.1.4-beta", -1],
    ["5.1.4+build.1", "5.1.4+build.2", 0], ["5.1.4-alpha", "5.1.4-beta", -1],
  ])("compares %s and %s", (a, b, result) => {
    expect(compareVersions(a, b)).toBe(result);
    expect(compareVersions(b, a)).toBe(result === 0 ? 0 : -result);
  });
  it.each(["garbage", "05.1.4", "5.1", "5.1.4-beta.01"])("rejects invalid release %s", (version) => {
    expect(() => compareVersions(version, "5.1.4")).toThrow("Invalid omo version");
  });
});

describe("autoUpdateOmo", () => {
  async function update(outputs: readonly (string | Error)[], enabled = true) {
    const calls: UpdateCommand[] = [];
    const states: OmoUpdateStatus[] = [];
    const run: UpdateCommandRunner = async (command) => {
      const output = outputs[calls.length];
      calls.push(command);
      if (output instanceof Error) throw output;
      if (output === undefined) throw new Error("unexpected command");
      return output;
    };
    const result = await autoUpdateOmo(binary, { HOME: "/fake" }, { enabled: () => enabled, run },
      new AbortController().signal, (status) => states.push(status));
    return { calls, states, result };
  }
  it("pins the official installer to the checked newer version and verifies the installed version", async () => {
    const { calls, states, result } = await update([available, "", "omo 5.1.5"]);
    expect(calls[0]?.args).toEqual(["update", "--dry-run"]);
    expect(calls[1]).toMatchObject({
      command: "/bin/bash", timeoutMs: 120_000,
      env: { HOME: "/fake", OMO_INSTALL_DIR: "/fake/bin", OMO_NO_MODIFY_PATH: "1" },
    });
    expect(calls[1]?.args.slice(-2)).toEqual([OMO_INSTALL_SCRIPT_URL, "5.1.5"]);
    expect(calls[1]?.args.join(" ")).not.toContain("not executable");
    expect(calls[2]?.args).toEqual(["--version"]);
    expect(result.version).toBe("5.1.5");
    expect(states).toEqual([{ state: "checking" }, { state: "installing" }, { state: "updated", from: "5.1.4", to: "5.1.5" }]);
  });
  it("disabled means no check or install command", async () => {
    const result = await update([], false);
    expect(result.calls).toEqual([]);
    expect(result.states).toEqual([{ state: "disabled" }]);
  });
  it.each([
    "omo 5.1.4 is the newest stable release",
    "omo 5.1.3 is available (running 5.1.4). Replace this binary with:",
  ])("does not install equal or older versions", async (output) => {
    const result = await update([output]);
    expect(result.calls).toHaveLength(1);
    expect(result.result).toEqual(binary);
    expect(result.states.at(-1)).toEqual({ state: "current" });
  });
  it.each([
    [new Error("offline")], [available, new Error("installation failed")],
    [available, "", "omo 5.1.4"], ["unexpected updater response"],
    ["omo invalid is available (running 5.1.4). Replace this binary with:"],
  ])("preserves startup with a failure notice", async (...outputs) => {
    const result = await update(outputs);
    expect(result.result).toEqual(binary);
    expect(result.states.at(-1)).toMatchObject({ state: "failed" });
  });
});

describe("startup with real fake command processes", () => {
  async function setup(mode: string, enabled = true) {
    const home = await mkdtemp(path.join(os.tmpdir(), "omo-ui-update-"));
    dirs.push(home);
    const env = {
      HOME: home, PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      FAKE_UPDATE_HOME: home, FAKE_UPDATE_MODE: mode,
      FAKE_OMO_HOME: home, FAKE_OMO_LOG: path.join(home, "rpc.log"),
    };
    let readyResolve: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => { readyResolve = resolve; });
    let updaterChild: ChildProcessWithoutNullStreams | undefined;
    let childClosed: Promise<unknown> | undefined;
    const fakeSpawn: SpawnImpl = (_command, args, options) => {
      const child = spawn(process.execPath, [fixture, ...args], options);
      if (args[0] === "update") {
        updaterChild = child;
        childClosed = once(child, "close");
        child.stderr.on("data", (data: Buffer) => { if (data.toString().includes("READY")) readyResolve(); });
      }
      return child;
    };
    const run: UpdateCommandRunner = (command) => runUpdateCommand(
      { ...command, args: command.command === "/bin/bash" ? ["install"] : command.args },
      fakeSpawn,
    );
    const supervisor = new OmoSupervisor({
      homeDir: home, baseEnv: env, clientVersion: "test",
      resolveEnv: async () => ({ env, fromLoginShell: false }),
      locate: async () => ({ ok: true, binary: { ...binary, path: path.join(home, "omo") } }),
      autoUpdate: { enabled: () => enabled, run },
      createClient: (options) => new AppServerClient({ ...options, spawnImpl: fakeSpawn }),
    });
    return { supervisor, home, ready, childClosed: () => childClosed, updaterChild: () => updaterChild };
  }

  it("installs with a fake command, then spawns and connects the app server with the new version", async () => {
    const { supervisor, home } = await setup("newer");
    try {
      await supervisor.start();
      expect(supervisor.getStatus()).toMatchObject({ state: "connected", omo: { version: "5.1.5" }, update: { state: "updated" } });
      expect(await readFile(path.join(home, "update.log"), "utf8")).toBe("check\ninstall\napp-server 5.1.5\n");
      await supervisor.restart();
      expect(await readFile(path.join(home, "update.log"), "utf8")).toBe("check\ninstall\napp-server 5.1.5\napp-server 5.1.5\n");
    } finally {
      await supervisor.stop();
    }
  });
  it("an offline check still spawns and connects the old app server", async () => {
    const { supervisor, home } = await setup("offline");
    try {
      await supervisor.start();
      expect(supervisor.getStatus()).toMatchObject({ state: "connected", update: { state: "failed", message: "offline" } });
      expect(await readFile(path.join(home, "update.log"), "utf8")).toBe("check\napp-server 5.1.4\n");
    } finally { await supervisor.stop(); }
  });
  it("disabled startup performs no check and launches immediately", async () => {
    const { supervisor, home } = await setup("newer", false);
    try {
      await supervisor.start();
      expect(supervisor.getStatus()).toMatchObject({ state: "connected", update: { state: "disabled" } });
      expect(await readFile(path.join(home, "update.log"), "utf8")).toBe("app-server 5.1.4\n");
    } finally { await supervisor.stop(); }
  });
  it("kills a hung checker at the exact fake deadline and still launches", async () => {
    const { supervisor, home, ready, childClosed } = await setup("timeout");
    vi.useFakeTimers();
    const started = supervisor.start();
    try {
      await ready;
      await vi.advanceTimersByTimeAsync(20_000);
      await childClosed();
      // Real app-server RPC timeouts are not the behavior under test.
      vi.useRealTimers();
      await started;
      expect(supervisor.getStatus()).toMatchObject({ state: "connected", update: { state: "failed", message: "omo update timed out after 20000 ms" } });
      expect(await readFile(path.join(home, "update.log"), "utf8")).toBe("check\napp-server 5.1.4\n");
    } finally {
      vi.useRealTimers();
      await supervisor.stop();
    }
  });
  it("quitting during a check cancels it without spawning an app server", async () => {
    const { supervisor, home, ready, childClosed } = await setup("timeout");
    const started = supervisor.start();
    try {
      await ready;
      await supervisor.stop();
      await childClosed();
      await started;
      expect(supervisor.getStatus().state).toBe("stopped");
      expect(await readFile(path.join(home, "update.log"), "utf8")).toBe("check\n");
    } finally { await supervisor.stop(); }
  });
});
