import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { locateOmo } from "../../electron/omo/locate";

let home: string;

async function stub(file: string, output = "omo 9.9.9 (engine: test)", mode = 0o755): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `#!/bin/sh\necho '${output}'\n`);
  await chmod(file, mode);
  return file;
}

async function writeInstallJson(content: string): Promise<void> {
  await mkdir(path.join(home, ".omo"), { recursive: true });
  await writeFile(path.join(home, ".omo", "install.json"), content);
}

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "omo-ui-locate-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("locateOmo", () => {
  it("prefers binPath from install.json over ~/.local/bin", async () => {
    const installed = await stub(path.join(home, "opt", "omo"));
    await stub(path.join(home, ".local", "bin", "omo"), "omo 1.0.0");
    await writeInstallJson(JSON.stringify({ method: "standalone", binPath: installed }));
    const result = await locateOmo({ env: {}, homeDir: home, loginPath: null });
    expect(result).toEqual({ ok: true, binary: { path: installed, version: "9.9.9", source: "install.json" } });
  });

  it("falls back to ~/.local/bin and then the login PATH", async () => {
    const pathDir = path.join(home, "path-bin");
    const onPath = await stub(path.join(pathDir, "omo"), "omo 2.0.0");
    const fromPath = await locateOmo({ env: {}, homeDir: home, loginPath: `/nonexistent:${pathDir}` });
    expect(fromPath).toEqual({ ok: true, binary: { path: onPath, version: "2.0.0", source: "login-path" } });

    const local = await stub(path.join(home, ".local", "bin", "omo"));
    const fromLocal = await locateOmo({ env: {}, homeDir: home, loginPath: pathDir });
    expect(fromLocal).toEqual({ ok: true, binary: { path: local, version: "9.9.9", source: "local-bin" } });
  });

  it("uses only the override when OMO_UI_OMO_BIN is set", async () => {
    await stub(path.join(home, ".local", "bin", "omo"));
    const missing = path.join(home, "missing", "omo");
    const result = await locateOmo({ env: { OMO_UI_OMO_BIN: missing }, homeDir: home, loginPath: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.tried.map((entry) => [entry.source, entry.path])).toEqual([["override", missing]]);
  });

  it("skips a malformed install.json", async () => {
    await writeInstallJson("{not json");
    const local = await stub(path.join(home, ".local", "bin", "omo"));
    const result = await locateOmo({ env: {}, homeDir: home, loginPath: null });
    expect(result).toEqual({ ok: true, binary: { path: local, version: "9.9.9", source: "local-bin" } });
  });

  it("rejects a non-executable binary and checks each real path once", async () => {
    const local = await stub(path.join(home, ".local", "bin", "omo"), "omo 9.9.9", 0o644);
    await writeInstallJson(JSON.stringify({ binPath: local }));
    const result = await locateOmo({ env: {}, homeDir: home, loginPath: path.dirname(local) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.tried.map((entry) => entry.source)).toEqual(["install.json"]);
  });

  it("rejects a binary whose --version output is not omo", async () => {
    await stub(path.join(home, ".local", "bin", "omo"), "something else");
    const result = await locateOmo({ env: {}, homeDir: home, loginPath: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.tried.map((entry) => entry.source)).toEqual(["install.json", "local-bin"]);
  });
});
