import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseEnvBlock, resolveLoginShellEnv, scrubChildEnv } from "../../electron/omo/shell-env";

describe("parseEnvBlock", () => {
  it("reads NUL-separated pairs between the markers and ignores surrounding noise", () => {
    const text = "motd noise\n__OMO_UI_ENV_START__PATH=/a:/b\0EQ=x=y\0MULTI=one\ntwo\0\0__OMO_UI_ENV_END__trailing";
    expect(parseEnvBlock(text)).toEqual({ PATH: "/a:/b", EQ: "x=y", MULTI: "one\ntwo" });
  });

  it("returns null when a marker is missing", () => {
    expect(parseEnvBlock("PATH=/a\0")).toBeNull();
    expect(parseEnvBlock("__OMO_UI_ENV_START__PATH=/a\0")).toBeNull();
  });
});

describe("scrubChildEnv", () => {
  it("drops agent session bindings and Electron launch flags but keeps PATH and HOME", () => {
    const scrubbed = scrubChildEnv({
      PATH: "/bin",
      HOME: "/h",
      PI_SESSION: "1",
      OMO_UI_OMO_BIN: "/x",
      SENPI_TOKEN: "t",
      ELECTRON_RUN_AS_NODE: "1",
      ELECTRON_NO_ATTACH_CONSOLE: "1",
    });
    expect(scrubbed).toEqual({ PATH: "/bin", HOME: "/h" });
  });
});

describe("resolveLoginShellEnv", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "omo-ui-shell-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("captures the environment printed by the login shell command", async () => {
    const shell = path.join(dir, "fake-shell");
    await writeFile(shell, '#!/bin/sh\necho "rc noise"\nexec /bin/sh -c "$2"\n');
    await chmod(shell, 0o755);
    const result = await resolveLoginShellEnv({ baseEnv: { PATH: "/usr/bin:/bin", MARKER: "kept" }, homeDir: "/h", shell });
    expect(result.fromLoginShell).toBe(true);
    expect(result.env["MARKER"]).toBe("kept");
    expect(result.env["PATH"]).toBe("/usr/bin:/bin");
  });

  it("falls back to baseEnv with common bin directories on PATH when the shell fails", async () => {
    const result = await resolveLoginShellEnv({
      baseEnv: { PATH: "/usr/bin", EMPTY: undefined },
      homeDir: "/h",
      shell: path.join(dir, "missing-shell"),
    });
    expect(result).toEqual({
      env: { PATH: "/opt/homebrew/bin:/usr/local/bin:/h/.local/bin:/usr/bin" },
      fromLoginShell: false,
    });
  });
});
