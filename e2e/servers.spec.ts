import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Terminal } from "@xterm/xterm";
import { launchApp, newSession, setTheme, shot, tempDir, WT } from "./helpers.ts";

const CONFIG = [
  "Host linux-box",
  "  HostName 10.0.0.5",
  "  User ubuntu",
  "  IdentityFile ~/.ssh/id_ed25519_lab",
  "Host win-box",
  "  HostName 10.0.0.6",
  "  User admin",
  "  Port 2222",
  "Host locked down",
  "  HostName 10.255.0.9",
  "Host *",
  "  User tester",
  "",
].join("\n");

test("the servers dock lists ssh config hosts, probes them without prompting and shows their specs", async () => {
  const dir = tempDir("servers");
  const config = path.join(dir, "config");
  writeFileSync(config, CONFIG);
  const log = path.join(dir, "fake-ssh.log");
  // `ssh` typed into the terminal resolves to this stub ahead of the real client.
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "ssh.cmd"), "@echo fake-ssh-session %*\r\n");
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const launched = await launchApp({
    omo: "fake", pickDir: tempDir("servers-project"), size: { width: 1440, height: 900 },
    extraEnv: { OMO_UI_SSH_CONFIG: config, OMO_UI_SSH_BIN: path.join(WT, "tests", "fixtures", "fake-ssh.mjs"), FAKE_SSH_LOG: log, [pathKey]: `${bin}${path.delimiter}${process.env[pathKey] ?? ""}` },
  });
  const { page } = launched;
  try {
    await newSession(page);
    await setTheme(page, "dark");
    await page.keyboard.press("Control+E");
    await page.getByTestId("right-tab-servers").click();
    const panel = page.getByTestId("servers-panel");
    await expect(panel).toBeVisible();
    const row = (alias: string) => panel.locator(`[data-testid="server-row"][data-alias="${alias}"]`);
    const select = (alias: string) => row(alias).locator("button").first().click();
    await expect(panel.getByTestId("server-row")).toHaveCount(4);
    await expect(row("win-box")).toContainText("admin@10.0.0.6:2222");
    await expect(row("locked")).toContainText("tester@10.255.0.9");
    for (const alias of ["linux-box", "win-box", "locked", "down"]) await expect(row(alias)).toHaveAttribute("data-status", "unknown");

    await panel.getByTestId("servers-check-all").click();
    await expect(row("linux-box")).toHaveAttribute("data-status", "online");
    await expect(row("win-box")).toHaveAttribute("data-status", "online");
    await expect(row("locked")).toHaveAttribute("data-status", "auth-failed");
    await expect(row("down")).toHaveAttribute("data-status", "unreachable");
    await expect(row("linux-box").getByTestId("server-latency")).toHaveText(/^\d+ ms$/);

    const detail = panel.getByTestId("server-detail");
    await select("linux-box");
    await expect(detail).toHaveAttribute("data-alias", "linux-box");
    await detail.getByTestId("server-refresh").click();
    const specs = detail.getByTestId("server-specs");
    await expect(specs).toHaveAttribute("data-family", "posix");
    await expect(specs.getByTestId("server-spec-cpu")).toContainText("AMD Ryzen 9 7950X");
    await expect(specs.getByTestId("server-spec-cores")).toContainText("32");
    await expect(specs.getByTestId("server-spec-ram")).toContainText("62.5 GB");
    await expect(specs.getByTestId("server-spec-gpu")).toContainText("RTX 4090");
    await expect(specs.getByTestId("server-spec-os")).toContainText("Ubuntu 22.04.4 LTS");
    await expect(specs.getByTestId("server-spec-uptime")).toContainText("4d 13h");
    await expect(specs.getByTestId("server-spec-load")).toContainText("0.52 0.48 0.40");
    await expect(row("linux-box").getByTestId("server-os")).toHaveText("Ubuntu");
    await shot(page, "servers-spec-card");

    await select("win-box");
    await detail.getByTestId("server-refresh").click();
    await expect(detail.getByTestId("server-specs")).toHaveAttribute("data-family", "windows");
    await expect(detail.getByTestId("server-spec-os")).toContainText("Windows 11 Pro");
    await expect(detail.getByTestId("server-spec-disk")).toContainText("C:");
    await expect(row("win-box").getByTestId("server-os")).toHaveText("Windows");

    await select("locked");
    await detail.getByTestId("server-test").click();
    await expect(detail.getByTestId("server-status")).toContainText("Auth failed (key not accepted)");
    await expect(detail.getByTestId("server-message")).toHaveText("tester@locked: Permission denied (publickey).");

    // Hidden hosts fold into their own group and the choice is kept in preferences.
    await row("down").hover();
    await row("down").getByTestId("server-hide").click();
    await expect(panel.getByTestId("servers-hidden-group")).toContainText("Hidden (1)");
    await expect(panel.getByTestId("servers-hidden-group").locator('[data-testid="server-row"]')).toHaveAttribute("data-alias", "down");
    await expect.poll(() => JSON.parse(readFileSync(path.join(launched.dirs.userData, "preferences.json"), "utf8")).hiddenSshHosts).toEqual(["down"]);
    await shot(page, "servers-list");

    // Every call is non-interactive; the config is only read.
    const calls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { options: string[]; alias: string; command: string });
    expect(calls.length).toBeGreaterThanOrEqual(7);
    for (const call of calls) expect(call.options).toEqual(["-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "-o", "StrictHostKeyChecking=accept-new"]);
    expect(calls.filter((call) => call.alias === "win-box").map((call) => call.command.split(" ")[0])).toEqual(["echo", "uname", "powershell"]);
    expect(readFileSync(config, "utf8")).toBe(CONFIG);
    const cache = JSON.parse(readFileSync(path.join(launched.dirs.userData, "ssh-hosts.json"), "utf8")) as { hosts: Record<string, { specs: { hostname: string } | null; specsAt: number | null }> };
    expect(cache.hosts["linux-box"]?.specs?.hostname).toBe("gpu-box");
    expect(cache.hosts["linux-box"]?.specsAt).toEqual(expect.any(Number));

    // The cache survives a reload of the panel.
    await page.getByTestId("right-tab-files").click();
    await page.getByTestId("right-tab-servers").click();
    await expect(row("linux-box")).toHaveAttribute("data-status", "online");
    await expect(row("linux-box").getByTestId("server-os")).toHaveText("Ubuntu");

    await select("linux-box");
    await page.getByTestId("server-copy").click();
    await expect(page.getByTestId("servers-notice")).toHaveText("Copied: ssh linux-box");

    await page.getByTestId("server-terminal").click();
    // A new terminal opens where terminals are placed (the bottom drawer by default) and runs the command alone.
    await expect(page.getByTestId("terminal-drawer")).toBeVisible();
    const pane = page.getByTestId("terminal-panel").locator('[data-testid="terminal-pane"][data-active]');
    await expect(pane).toHaveAttribute("data-terminal-id", "t2");
    await expect(pane).toHaveAttribute("data-running", "true", { timeout: 30_000 });
    const output = pane.getByTestId("terminal-output");
    await output.evaluate((element: HTMLDivElement & { terminal?: Terminal }) => new Promise<void>((resolve, reject) => {
      const terminal = element.terminal;
      if (terminal === undefined) { reject(new Error("xterm is not ready")); return; }
      const check = (): void => {
        const buffer = terminal.buffer.active;
        for (let index = 0; index < buffer.length; index += 1) {
          if (buffer.getLine(index)?.translateToString(true).trim() === "fake-ssh-session linux-box") { subscription.dispose(); clearTimeout(timeout); resolve(); return; }
        }
      };
      const subscription = terminal.onWriteParsed(check);
      const timeout = setTimeout(() => { subscription.dispose(); reject(new Error("ssh linux-box did not run in the terminal")); }, 20_000);
      check();
    }));
    expect(existsSync(config)).toBe(true);
  } finally {
    await launched.close();
  }
});
