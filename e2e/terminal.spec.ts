import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";
import type { Terminal } from "@xterm/xterm";
import { launchApp, newSession, setTheme, shot, tempDir } from "./helpers.ts";

/** Subscribe before sending keys: echoed input alone must not satisfy a command result. */
async function command(output: Locator, input: string, expected: string | string[]): Promise<void> {
  const result = output.evaluate((element: HTMLDivElement & { terminal?: Terminal }, wanted) => {
    const terminal = element.terminal;
    if (terminal === undefined) throw new Error("xterm is not ready");
    return new Promise<void>((resolve, reject) => {
      const check = (): void => {
        const buffer = terminal.buffer.active;
        for (let index = 0; index < buffer.length; index += 1) {
          const line = buffer.getLine(index)?.translateToString(true).trim();
          if (line === undefined || !(Array.isArray(wanted) ? wanted.includes(line) : line === wanted)) continue;
          subscription.dispose(); clearTimeout(timeout); resolve(); return;
        }
      };
      const subscription = terminal.onWriteParsed(check);
      const timeout = setTimeout(() => { subscription.dispose(); reject(new Error(`No terminal line: ${wanted}`)); }, 20_000);
      check();
    });
  }, expected);
  await output.page().keyboard.type(input);
  await output.page().keyboard.press("Enter");
  await result;
}

test("interactive PTY supports PowerShell colors, prompts, UTF-8, workspace and resizing", async () => {
  // Given
  const workspace = tempDir("terminal");
  const running = await launchApp({ omo: "fake", pickDir: workspace, size: { width: 1280, height: 820 } });
  try {
    await newSession(running.page);
    await running.page.keyboard.press("Control+Backquote");
    const panel = running.page.getByTestId("terminal-panel");
    const output = panel.getByTestId("terminal-output");
    await expect(panel).toHaveAttribute("data-running", "true");
    await expect(output.locator(".xterm-helper-textarea")).toBeFocused();
    // When / Then: a normal interactive shell, not a command reader on piped stdin.
    await command(output, '"edition-$($PSVersionTable.PSEdition)"', ["edition-Desktop", "edition-Core"]);
    await command(output, "Write-Host -ForegroundColor Red red-ok", "red-ok");
    const red = await output.evaluate((element: HTMLDivElement & { terminal?: Terminal }) => {
      const terminal = element.terminal;
      if (terminal === undefined) throw new Error("xterm unavailable");
      const buffer = terminal.buffer.active;
      for (let index = 0; index < buffer.length; index += 1) {
        const line = buffer.getLine(index);
        if (line?.translateToString(true).trim() === "red-ok") return line.getCell(0)?.getFgColor();
      }
      return undefined;
    });
    expect(red).toBe(9);
    await command(output, "Write-Output '한글-정상'", "한글-정상");
    await command(output, "(Get-Location).Path.Split([IO.Path]::DirectorySeparatorChar)[-1]", path.basename(workspace));
    // Read-Host consumes input inside the same command, without an application input/history layer.
    const prompt = output.evaluate((element: HTMLDivElement & { terminal?: Terminal }) => {
      const terminal = element.terminal;
      if (terminal === undefined) throw new Error("xterm unavailable");
      return new Promise<void>((resolve, reject) => {
        const subscription = terminal.onWriteParsed(() => {
          const buffer = terminal.buffer.active;
          if (!buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true).startsWith("name:")) return;
          clearTimeout(timeout); subscription.dispose(); resolve();
        });
        const timeout = setTimeout(() => { subscription.dispose(); reject(new Error("Read-Host did not prompt")); }, 20_000);
      });
    });
    await running.page.keyboard.type('$n = Read-Host \'name\'; "hi-$n"');
    await running.page.keyboard.press("Enter");
    await prompt;
    await command(output, "omo", "hi-omo");
    const before = await output.evaluate((element: HTMLDivElement & { terminal?: Terminal }) => element.terminal?.cols);
    await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(600, 820));
    await expect(panel).toHaveAttribute("data-placement", "overlay");
    const resized = output.evaluate((element: HTMLDivElement & { terminal?: Terminal }, previous) => {
      const terminal = element.terminal;
      if (terminal === undefined) throw new Error("xterm unavailable");
      return new Promise<number>((resolve, reject) => {
        if (terminal.cols !== previous) { resolve(terminal.cols); return; }
        const subscription = terminal.onResize(({ cols }) => { clearTimeout(timeout); subscription.dispose(); resolve(cols); });
        const timeout = setTimeout(() => { subscription.dispose(); reject(new Error("PTY did not resize")); }, 20_000);
      });
    }, before);
    const cols = await resized;
    expect(cols).not.toBe(before);
    await output.locator(".xterm-helper-textarea").focus();
    await command(output, '"width-$($Host.UI.RawUI.WindowSize.Width)"', `width-${cols}`);
    await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 820));
    await setTheme(running.page, "light");
    await shot(running.page, "terminal-light");
    await setTheme(running.page, "dark");
    await shot(running.page, "terminal-dark");
  } finally { await running.close(); }
});

test("terminal toggle preserves output and sends Escape and Ctrl+L to the shell", async () => {
  // Given
  const running = await launchApp({ omo: "fake", pickDir: tempDir("terminal-shortcut"), size: { width: 1280, height: 820 } });
  try {
    await newSession(running.page);
    await running.page.keyboard.press("Control+Backquote");
    const panel = running.page.getByTestId("terminal-panel");
    const output = panel.getByTestId("terminal-output");
    await expect(panel).toHaveAttribute("data-running", "true");
    await expect(output.locator(".xterm-helper-textarea")).toBeFocused();
    await command(output, "Write-Output 'reopen-ok'", "reopen-ok");
    // When
    await running.page.keyboard.press("Escape");
    // Then
    await expect(panel).toBeVisible();
    await running.page.keyboard.press("Control+Backquote");
    await expect(panel).toHaveCount(0);
    await running.page.keyboard.press("Control+Backquote");
    await expect(panel).toHaveAttribute("data-running", "true");
    await expect(output.locator(".xterm-helper-textarea")).toBeFocused();
    await command(output, "", "reopen-ok");
    await running.page.keyboard.press("Control+l");
    await command(output, "Write-Output 'clear-ok'", "clear-ok");
    await command(output, "try { Get-Item '__terminal_missing__' -ErrorAction Stop } catch { Write-Output 'terminal-error-ok' }", "terminal-error-ok");
    await command(output, "exit 7", "Shell exited (7)");
    await expect(panel).toHaveAttribute("data-running", "false");
    await panel.getByTestId("terminal-restart").click();
    await expect(panel).toHaveAttribute("data-running", "true");
    await command(output, "Write-Output 'restart-ok'", "restart-ok");
  } finally { await running.close(); }
});
