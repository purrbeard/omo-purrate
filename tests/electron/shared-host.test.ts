import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NativeConnection } from "../../electron/omo/native/connection";
import { ensureSharedHost, SharedHostUnavailable, transportAddress } from "../../electron/omo/native/shared-host";
import type { ExecFileImpl } from "../../electron/omo/native/shared-host";

const FAKE_OMO = path.join(__dirname, "..", "fixtures", "fake-omo.mjs");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function execAnswering(stdout: string, code: number | null, stderr = ""): ExecFileImpl {
  return (_file, _args, _options, callback) => {
    callback(code === null ? null : Object.assign(new Error(`exit ${code}`), { code }), stdout, stderr);
  };
}

describe("transportAddress", () => {
  it("maps a win32 socket path to omo's named pipe from the normalized lower-cased path and the secret", () => {
    // Pinned from the formula that reached a live omo 5.1.35 shared host on this machine.
    expect(transportAddress("C:\\Users\\Me\\.omo\\agent\\rpc\\rpc.sock", Buffer.alloc(32, 1), "win32")).toBe("\\\\.\\pipe\\senpi-rpc-fe89933bd27d5a047fb8c4c9bc63c1d3");
    expect(transportAddress("c:/users/me/.omo/agent/rpc/../rpc/rpc.sock", Buffer.alloc(32, 1), "win32")).toBe("\\\\.\\pipe\\senpi-rpc-fe89933bd27d5a047fb8c4c9bc63c1d3");
  });

  it("keeps POSIX socket paths and explicit pipe names unchanged", () => {
    expect(transportAddress("/home/me/.omo/agent/rpc/rpc.sock", Buffer.alloc(32, 1), "linux")).toBe("/home/me/.omo/agent/rpc/rpc.sock");
    expect(transportAddress("\\\\.\\pipe\\custom", Buffer.alloc(32, 1), "win32")).toBe("\\\\.\\pipe\\custom");
  });
});

describe("ensureSharedHost", () => {
  it("returns the socket from the one JSON line `omo host ensure` prints", async () => {
    const line = JSON.stringify({ action: "reuse", socket: "/agent/rpc/rpc.sock", instanceId: "i-1", reused: true });
    await expect(ensureSharedHost("omo", "/", {}, execAnswering(`${line}\n`, null))).resolves.toEqual({ socket: "/agent/rpc/rpc.sock", action: "reuse", instanceId: "i-1" });
  });

  it("reports a refusal with the host's reason and the exit code", async () => {
    const line = JSON.stringify({ action: "refuse", reason: "win32_attach_only", host: {} });
    const failure = ensureSharedHost("omo", "/", {}, execAnswering(line, 3));
    await expect(failure).rejects.toBeInstanceOf(SharedHostUnavailable);
    await expect(failure).rejects.toThrow("omo host ensure failed (exit 3): win32_attach_only");
  });

  it("falls back to the last stderr line when there is no JSON answer", async () => {
    await expect(ensureSharedHost("omo", "/", {}, execAnswering("", 1, "boot\nUnknown command: host\n"))).rejects.toThrow("Unknown command: host");
  });
});

describe("shared host connection", () => {
  it("attaches to the host `host ensure` started, answers over the socket, and the host exits after the last connection", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "omo-ui-shared-host-"));
    dirs.push(home);
    const env = { ...process.env, FAKE_OMO_HOME: home } as Record<string, string>;
    // The detached host keeps its working directory open on Windows, so it must not be the directory this test removes.
    const host = await ensureSharedHost(FAKE_OMO, os.tmpdir(), env);
    expect(host.socket).toBe(path.join(home, "rpc", "rpc.sock"));
    const connection = new NativeConnection({ command: "unused", args: [], cwd: home, env, socket: host.socket });
    connection.start();
    expect(connection.pid).toBeNull();
    await expect(connection.send("get_protocol_info", {}, 10_000)).resolves.toMatchObject({ mode: "multi", serverVersion: "5.1.4-fake" });
    const exited = connection.exited;
    await connection.stop({ afterStdinEnd: 2_000, afterSigterm: 0 });
    await expect(exited).resolves.toMatchObject({ expected: true });
    expect(() => connection.write({ type: "get_state" })).toThrow("omo is not running");
  });

  it("surfaces an unusable host secret when the connection starts", () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "omo-ui-shared-host-"));
    dirs.push(home);
    const connection = new NativeConnection({ command: "unused", args: [], cwd: home, env: {}, socket: path.join(home, "missing.sock"), connectImpl: () => { throw new SharedHostUnavailable("no secret"); } });
    expect(() => connection.start()).toThrow("no secret");
  });
});
