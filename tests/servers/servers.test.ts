import { describe, expect, it } from "vitest";
import { classify, createLimiter, parsePosix, parseWindows, POSIX_PROBE, probeSpecs, stderrLine, WINDOWS_PROBE, WINDOWS_SCRIPT } from "../../electron/servers/probe";
import type { SshRun } from "../../electron/servers/probe";
import { hostMatches, parseSshConfig } from "../../electron/servers/ssh-config";
import { hostAddress, osBadge, sizeFromMb, uptime } from "../../src/ui/servers/format";

const run = (patch: Partial<SshRun>): SshRun => ({ code: 0, stdout: "", stderr: "", ms: 40, timedOut: false, spawnError: null, ...patch });

describe("ssh config", () => {
  it("lists concrete aliases with the first obtained HostName, User, Port and every IdentityFile", () => {
    const files: Record<string, string> = {
      "/h/.ssh/conf.d/work.conf": "Host build\n  HostName 10.0.0.7\n  Include nested\nHost build-*\n  User ci\n",
    };
    const text = [
      "# comment",
      "Include conf.d/*.conf",
      "Host web \"db one\"",
      "  HostName %h.example.com",
      "  Port 2222",
      "  IdentityFile ~/.ssh/id_a",
      "Host *.example.com !skip.example.com",
      "  User nobody",
      "Match host web",
      "  User matched",
      "Host *",
      "  User deploy",
      "  IdentityFile ~/.ssh/id_default",
      "  Port 22",
    ].join("\n");
    const hosts = parseSshConfig(text, { home: "/h", sshDir: "/h/.ssh", read: (file) => {
      const content = files[file.replace(/\\/g, "/")];
      if (content === undefined) throw new Error("ENOENT " + file);
      return content;
    } });
    expect(hosts.map((host) => host.alias)).toEqual(["web", "db one"]);
    expect(hosts[0]).toEqual({ alias: "web", hostName: "web.example.com", user: "deploy", port: 2222, identityFiles: ["~/.ssh/id_a", "~/.ssh/id_default"] });
    expect(hosts[1]?.hostName).toBe("db one.example.com");
  });
  it("follows Include one level with globbed file names", () => {
    const hosts = parseSshConfig("Include extra\nHost a\n", { home: "/h", sshDir: "/h/.ssh", read: (file) => {
      if (file.replace(/\\/g, "/").endsWith("/extra")) return "Host b\n  HostName 1.2.3.4\n  User u\nInclude deeper\n";
      if (file.replace(/\\/g, "/").endsWith("/deeper")) return "Host c\n";
      throw new Error("ENOENT");
    } });
    expect(hosts.map((host) => [host.alias, host.hostName, host.user, host.port])).toEqual([["b", "1.2.3.4", "u", 22], ["a", "a", null, 22]]);
  });
  it("matches patterns like ssh: a negated match excludes", () => {
    expect(hostMatches(["*.dev", "!x.dev"], "a.dev")).toBe(true);
    expect(hostMatches(["*.dev", "!x.dev"], "x.dev")).toBe(false);
    expect(hostMatches(["web?"], "web1")).toBe(true);
  });
});

describe("probe", () => {
  it("never prompts and probes POSIX first", () => {
    expect(POSIX_PROBE.startsWith("uname -s || exit 97")).toBe(true);
    expect(WINDOWS_PROBE).toMatch(/^powershell -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/);
    expect(Buffer.from(WINDOWS_PROBE.split(" ").at(-1)!, "base64").toString("utf16le")).toBe(WINDOWS_SCRIPT);
  });
  it("classifies ssh failures by exit 255 and stderr", () => {
    expect(classify(run({ code: 0 })).status).toBe("online");
    expect(classify(run({ code: 97 })).status).toBe("online");
    expect(classify(run({ code: 255, stderr: "Warning: Permanently added 'x' (ED25519) to the list of known hosts.\r\nme@x: Permission denied (publickey).\r\n" })))
      .toEqual({ status: "auth-failed", message: "me@x: Permission denied (publickey)." });
    expect(classify(run({ code: 255, stderr: "ssh: connect to host 10.0.0.9 port 22: Connection timed out\n" })))
      .toEqual({ status: "unreachable", message: "ssh: connect to host 10.0.0.9 port 22: Connection timed out" });
    expect(classify(run({ code: null, timedOut: true, ms: 15_000 })).status).toBe("unreachable");
    expect(classify(run({ code: null, spawnError: "spawn ssh ENOENT" }))).toEqual({ status: "unknown", message: "spawn ssh ENOENT" });
    expect(stderrLine("")).toBeNull();
  });
  it("parses the POSIX probe output", () => {
    const stdout = [
      "Linux", "@@omo@@hostname", "gpu-box", "@@omo@@os", "Ubuntu 22.04.4 LTS", "@@omo@@kernel", "6.5.0-41-generic", "@@omo@@arch", "x86_64",
      "@@omo@@cores", "32", "@@omo@@cpu", " AMD Ryzen 9 7950X 16-Core Processor", "@@omo@@mem",
      "MemTotal:       65536000 kB", "SwapTotal:       2097148 kB", "SwapFree:        2097148 kB", "MemAvailable:   50000000 kB",
      "@@omo@@disk", "/dev/nvme0n1p2  960000000 400000000 520000000  44% /", "@@omo@@load", "0.52 0.48 0.40 1/900 12345",
      "@@omo@@uptime", "93784.12 1000000.00", "@@omo@@gpu", "NVIDIA GeForce RTX 4090, 24564", "@@omo@@end",
    ].join("\n");
    const specs = parsePosix(stdout)!;
    expect(specs).toMatchObject({ family: "posix", system: "Linux", hostname: "gpu-box", osName: "Ubuntu 22.04.4 LTS", arch: "x86_64", cores: 32,
      cpuModel: "AMD Ryzen 9 7950X 16-Core Processor", load: "0.52 0.48 0.40", uptimeSeconds: 93784.12, gpus: [{ name: "NVIDIA GeForce RTX 4090", memoryMb: 24564 }] });
    expect(specs.ramTotalMb).toBe(64000);
    expect(specs.disks[0]?.mount).toBe("/");
    expect(osBadge(specs)).toBe("Ubuntu");
    expect(parsePosix("'uname' is not recognized as an internal or external command")).toBeNull();
  });
  it("parses the Windows probe JSON and puts the system drive first", () => {
    const stdout = JSON.stringify({ hostname: "WIN-BOX", caption: "Microsoft Windows 11 Pro", version: "10.0.26200", arch: "64비트", cpu: "Intel(R) Core(TM) i7-14700K",
      cores: 28, load: 7, ramTotalKb: 67108864, ramFreeKb: 33554432, swapTotalMb: 4096, swapUsedMb: 1024, systemDrive: "C:",
      disks: [{ id: "D:", size: 2e12, free: 1e12 }, { id: "C:", size: 1e12, free: 5e11 }], gpus: { name: "NVIDIA GeForce RTX 4080", ram: 4293918720 }, uptimeSeconds: 3600 });
    const specs = parseWindows("#< CLIXML\r\n" + stdout)!;
    expect(specs).toMatchObject({ family: "windows", osName: "Windows 11 Pro", cores: 28, load: "7%", ramTotalMb: 65536, swapFreeMb: 3072, uptimeSeconds: 3600 });
    expect(specs.disks.map((disk) => disk.mount)).toEqual(["C:", "D:"]);
    expect(specs.gpus).toEqual([{ name: "NVIDIA GeForce RTX 4080", memoryMb: 4095 }]);
    expect(osBadge(specs)).toBe("Windows");
  });
  it("falls back to the Windows probe when the POSIX probe does not run", async () => {
    const commands: string[] = [];
    const result = await probeSpecs(async (_alias, command) => {
      commands.push(command);
      return command === POSIX_PROBE ? run({ code: 97, stderr: "'uname' is not recognized" }) : run({ stdout: JSON.stringify({ hostname: "W", caption: "Windows Server 2022" }) });
    }, "win");
    expect(commands).toEqual([POSIX_PROBE, WINDOWS_PROBE]);
    expect(result.specs?.osName).toBe("Windows Server 2022");
    const denied = await probeSpecs(async () => run({ code: 255, stderr: "u@h: Permission denied (publickey)." }), "h");
    expect(denied).toEqual({ status: "auth-failed", message: "u@h: Permission denied (publickey).", latencyMs: null, specs: null });
  });
  it("runs at most the limit at once", async () => {
    const limit = createLimiter(3);
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const tasks = Array.from({ length: 7 }, () => limit(async () => {
      active += 1; peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
    }));
    while (releases.length > 0 || active > 0) { await Promise.resolve(); releases.shift()?.(); await Promise.resolve(); }
    await Promise.all(tasks);
    expect(peak).toBe(3);
  });
});

describe("format", () => {
  it("formats addresses, sizes and uptime", () => {
    expect(hostAddress({ alias: "a", hostName: "1.2.3.4", user: "ubuntu", port: 22, identityFiles: [] })).toBe("ubuntu@1.2.3.4");
    expect(hostAddress({ alias: "a", hostName: "h", user: null, port: 2200, identityFiles: [] })).toBe("h:2200");
    expect(sizeFromMb(65536)).toBe("64.0 GB");
    expect(sizeFromMb(1024 * 960)).toBe("960 GB");
    expect(sizeFromMb(1024 * 2048)).toBe("2.0 TB");
    expect([59, 3600 * 5 + 720, 86400 * 3 + 3600 * 4].map(uptime)).toEqual(["0m", "5h 12m", "3d 4h"]);
  });
});
