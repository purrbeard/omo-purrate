import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InstallLogLine, InstallResult } from "../../shared/ipc";
import { runInstaller } from "../../electron/omo/installer";
import type { SpawnImpl } from "../../electron/omo/app-server-client";

function scripted(script: string): { spawnImpl: SpawnImpl; calls: Array<readonly string[]> } {
  const calls: Array<readonly string[]> = [];
  const spawnImpl: SpawnImpl = (command, args, options) => {
    calls.push([command, ...args]);
    return spawn("/bin/sh", ["-c", script], options);
  };
  return { spawnImpl, calls };
}

describe("runInstaller", () => {
  it("streams stdout and stderr lines and reports success", async () => {
    const { spawnImpl, calls } = scripted("echo one; echo two >&2; printf partial");
    const lines: InstallLogLine[] = [];
    const result = await runInstaller({ env: { PATH: "/usr/bin:/bin" }, onLine: (line) => lines.push(line), spawnImpl });
    expect(result).toEqual({ ok: true, exitCode: 0 });
    expect(calls[0]?.slice(0, 2)).toEqual(["/bin/bash", "-lc"]);
    expect(lines).toContainEqual({ stream: "stdout", text: "one" });
    expect(lines).toContainEqual({ stream: "stdout", text: "partial" });
    expect(lines).toContainEqual({ stream: "stderr", text: "two" });
  });

  it("reports failure with the exit code", async () => {
    const { spawnImpl } = scripted("exit 4");
    await expect(runInstaller({ env: {}, onLine: () => undefined, spawnImpl })).resolves.toEqual({ ok: false, exitCode: 4 });
  });

  it("kills the installer on timeout", async () => {
    const { spawnImpl } = scripted("exec sleep 30");
    await expect(runInstaller({ env: {}, onLine: () => undefined, spawnImpl, timeoutMs: 50 })).resolves.toEqual({ ok: false, exitCode: null });
  });
});

describe("runInstaller with bash and curl", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "omo-ui-installer-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function install(script: string | null): Promise<{ result: InstallResult; lines: InstallLogLine[] }> {
    const file = path.join(dir, "install.sh");
    if (script !== null) writeFileSync(file, script);
    const lines: InstallLogLine[] = [];
    const result = await runInstaller({
      env: { PATH: "/usr/bin:/bin", HOME: dir, TMPDIR: dir },
      onLine: (line) => lines.push(line),
      scriptUrl: pathToFileURL(file).href,
    });
    return { result, lines };
  }

  it("runs the downloaded script from a file, so a set -u BASH_SOURCE main guard passes, then removes the file", async () => {
    const { result, lines } = await install(
      ["set -euo pipefail", 'main() { echo "ran $0"; }', 'if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi', ""].join("\n"),
    );
    expect(result).toEqual({ ok: true, exitCode: 0 });
    const scriptPath = lines.find((line) => line.stream === "stdout" && line.text.startsWith("ran "))?.text.slice("ran ".length) ?? "";
    expect(path.basename(scriptPath)).toMatch(/^omo-install-sh\./);
    expect(existsSync(scriptPath)).toBe(false);
  });

  it("reports the script's exit code", async () => {
    const { result } = await install("exit 3\n");
    expect(result).toEqual({ ok: false, exitCode: 3 });
  });

  it("fails without running a script when the download fails", async () => {
    const { result, lines } = await install(null);
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(lines.filter((line) => line.stream === "stdout")).toEqual([]);
  });
});
