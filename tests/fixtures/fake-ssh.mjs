#!/usr/bin/env node
// Fake ssh for the servers e2e: canned answers per alias, one JSON line per call in FAKE_SSH_LOG.
// argv: [...options, "--", alias, command]
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const split = args.indexOf("--");
const options = split < 0 ? args : args.slice(0, split);
const [alias = "", command = ""] = split < 0 ? [] : args.slice(split + 1);
if (process.env.FAKE_SSH_LOG) appendFileSync(process.env.FAKE_SSH_LOG, `${JSON.stringify({ options, alias, command: command.slice(0, 40) })}\n`);

const POSIX = [
  "Linux", "@@omo@@hostname", "gpu-box", "@@omo@@os", "Ubuntu 22.04.4 LTS", "@@omo@@kernel", "6.5.0-41-generic", "@@omo@@arch", "x86_64",
  "@@omo@@cores", "32", "@@omo@@cpu", " AMD Ryzen 9 7950X 16-Core Processor", "@@omo@@mem",
  "MemTotal:       65536000 kB", "MemAvailable:   50000000 kB", "SwapTotal:       2097148 kB", "SwapFree:        2097148 kB",
  "@@omo@@disk", "/dev/nvme0n1p2  960000000 400000000 520000000  44% /", "@@omo@@load", "0.52 0.48 0.40 1/900 12345",
  "@@omo@@uptime", "393784.12 1000000.00", "@@omo@@gpu", "NVIDIA GeForce RTX 4090, 24564", "@@omo@@end", "",
].join("\n");
const WINDOWS = JSON.stringify({
  hostname: "WIN-BUILD", caption: "Microsoft Windows 11 Pro", version: "10.0.26200", arch: "64-bit", cpu: ["Intel(R) Core(TM) i7-14700K"], cores: 28, load: 9,
  ramTotalKb: 67108864, ramFreeKb: 30000000, swapTotalMb: 4096, swapUsedMb: 512, systemDrive: "C:",
  disks: [{ id: "C:", size: 2000398934016, free: 900000000000 }, { id: "D:", size: 4000787030016, free: 3000000000000 }],
  gpus: [{ name: "NVIDIA GeForce RTX 4080", ram: 4293918720 }], uptimeSeconds: 7200,
});

const fail = (line) => { process.stderr.write(`${line}\r\n`); process.exit(255); };
switch (alias) {
  case "locked": fail("tester@locked: Permission denied (publickey)."); break;
  case "down": fail("ssh: connect to host 10.255.0.9 port 22: Connection timed out"); break;
  case "linux-box":
    process.stdout.write(command.startsWith("uname -s") ? POSIX : "ok\n");
    break;
  case "win-box":
    if (command.startsWith("uname -s")) { process.stderr.write("'uname' is not recognized as an internal or external command,\r\noperable program or batch file.\r\n"); process.exit(97); }
    process.stdout.write(command.startsWith("powershell ") ? `${WINDOWS}\r\n` : "ok\r\n");
    break;
  default: fail(`ssh: Could not resolve hostname ${alias}: No such host is known.`);
}
