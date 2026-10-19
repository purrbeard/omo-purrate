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
    await expect(panel).toHaveAttribute("data-placement", "bottom");
    await expect(output.locator(".xterm-helper-textarea")).toBeFocused();
    const pane = panel.getByTestId("terminal-pane");
    await expect(pane).toHaveAttribute("data-cursor-blink", "true");
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
    await expect(running.page.getByTestId("app-frame")).toHaveAttribute("data-narrow", "true");
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
    // The narrow layout can settle through more than one xterm resize, so the shell's width is compared with the
    // terminal's columns when its answer is parsed, not with the first resize.
    const answered = output.evaluate((element: HTMLDivElement & { terminal?: Terminal }) => {
      const terminal = element.terminal;
      if (terminal === undefined) throw new Error("xterm unavailable");
      return new Promise<{ reported: number; cols: number }>((resolve, reject) => {
        const check = (): void => {
          const buffer = terminal.buffer.active;
          for (let index = 0; index < buffer.length; index += 1) {
            // PSReadLine can redraw its continuation prompt onto the answer's row after a resize, so the answer is
            // matched as a token; the echoed command (`width-$(...)`) never matches digits.
            const match = /(?:^|\s)width-(\d+)(?:\s|$)/.exec(buffer.getLine(index)?.translateToString(true).trim() ?? "");
            if (match === null) continue;
            subscription.dispose(); clearTimeout(timeout); resolve({ reported: Number(match[1]), cols: terminal.cols }); return;
          }
        };
        const subscription = terminal.onWriteParsed(check);
        const timeout = setTimeout(() => { subscription.dispose(); reject(new Error("The shell did not report its width")); }, 20_000);
      });
    });
    await running.page.keyboard.type('"width-$($Host.UI.RawUI.WindowSize.Width)"');
    await running.page.keyboard.press("Enter");
    const width = await answered;
    expect(width.reported).toBe(width.cols);
    expect(width.cols).not.toBe(before);
    // The font size and cursor blink preferences reach the open xterm and are mirrored on the pane. Changing the font
    // refits the PTY, so it runs after the output and resize checks above.
    await running.page.evaluate(() => window.omo.setPreferences({ terminalFontSize: 17, terminalCursorBlink: false }));
    await expect(pane).toHaveAttribute("data-font-size", "17");
    await expect(pane).toHaveAttribute("data-cursor-blink", "false");
    const options = await output.evaluate((element: HTMLDivElement & { terminal?: Terminal }) => ({ size: element.terminal?.options.fontSize, blink: element.terminal?.options.cursorBlink }));
    expect(options).toEqual({ size: 17, blink: false });
    await running.page.evaluate(() => window.omo.setPreferences({ terminalFontSize: null, terminalCursorBlink: true }));
    await expect(pane).toHaveAttribute("data-cursor-blink", "true");
    await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 820));
    await setTheme(running.page, "light");
    await shot(running.page, "terminal-light");
    await setTheme(running.page, "dark");
    await shot(running.page, "terminal-dark");
  } finally { await running.close(); }
});

test("split terminals run their own shells, close independently and keep running across bottom and side placement", async () => {
  // Given: the default bottom drawer at the capture size.
  const running = await launchApp({ omo: "fake", pickDir: tempDir("terminal-split"), size: { width: 1440, height: 900 } });
  try {
    await newSession(running.page);
    await setTheme(running.page, "dark");
    await running.page.keyboard.press("Control+Backquote");
    const page = running.page;
    const panel = page.getByTestId("terminal-panel");
    const pane = (id: string): Locator => panel.locator(`[data-testid="terminal-pane"][data-terminal-id="${id}"]`);
    const output = (id: string): Locator => pane(id).getByTestId("terminal-output");
    const focus = async (id: string): Promise<void> => {
      await output(id).click();
      await expect(output(id).locator(".xterm-helper-textarea")).toBeFocused();
    };
    const lines = (id: string): Promise<string[]> => output(id).evaluate((element: HTMLDivElement & { terminal?: Terminal }) => {
      const buffer = element.terminal?.buffer.active;
      if (buffer === undefined) throw new Error("xterm unavailable");
      return Array.from({ length: buffer.length }, (_unused, index) => buffer.getLine(index)?.translateToString(true).trim() ?? "");
    });
    await expect(page.getByTestId("terminal-drawer")).toBeVisible();
    await expect(panel).toHaveAttribute("data-placement", "bottom");
    await expect(pane("t1")).toHaveAttribute("data-running", "true");
    await expect(page.getByTestId("terminal-list")).toHaveCount(0);
    await command(output("t1"), "$who = 'first'; Write-Output 'one-ok'", "one-ok");

    // When: split side by side.
    await panel.getByTestId("terminal-split-horizontal").click();
    // Then: a second shell to the right, focused, with its own state and output.
    await expect(pane("t2")).toHaveAttribute("data-running", "true");
    await expect(output("t2").locator(".xterm-helper-textarea")).toBeFocused();
    await expect(panel.getByTestId("terminal-panes")).toHaveAttribute("data-split", "horizontal");
    await command(output("t2"), "$who = 'second'; \"who-$who\"", "who-second");
    await focus("t1");
    await expect(panel).toHaveAttribute("data-active-terminal", "t1");
    await command(output("t1"), '"who-$who"', "who-first");
    expect(await lines("t1")).not.toContain("who-second");
    expect(await lines("t2")).not.toContain("one-ok");
    const [left, right] = [await pane("t1").boundingBox(), await pane("t2").boundingBox()];
    expect(right!.x).toBeGreaterThan(left!.x + left!.width - 4);
    expect(Math.abs(right!.y - left!.y)).toBeLessThan(2);
    const list = page.getByTestId("terminal-list");
    await expect(list.getByTestId("terminal-group")).toHaveAttribute("data-split", "horizontal");
    await expect(list.getByTestId("terminal-group")).toContainText("Side by side");
    await expect(list.getByTestId("terminal-row")).toHaveText(["Terminal 1", "Terminal 2"]);
    await expect(list.locator('[data-testid="terminal-row"][aria-current="true"]')).toHaveText("Terminal 1");
    await shot(page, "terminal-bottom-side-by-side");

    // When: a new terminal, split stacked.
    await panel.getByTestId("terminal-new").click();
    await expect(pane("t3")).toHaveAttribute("data-running", "true");
    await expect(pane("t1")).toHaveCount(0);
    await panel.getByTestId("terminal-split-vertical").click();
    // Then
    await expect(pane("t4")).toHaveAttribute("data-running", "true");
    await expect(panel.getByTestId("terminal-panes")).toHaveAttribute("data-split", "vertical");
    const [top, bottom] = [await pane("t3").boundingBox(), await pane("t4").boundingBox()];
    expect(bottom!.y).toBeGreaterThan(top!.y + top!.height - 4);
    expect(Math.abs(bottom!.x - top!.x)).toBeLessThan(2);
    await command(output("t4"), "Write-Output 'four-ok'", "four-ok");
    await expect(list.getByTestId("terminal-group").nth(1)).toHaveAttribute("data-split", "vertical");
    await expect(list.getByTestId("terminal-group").nth(1)).toContainText("Stacked");
    await shot(page, "terminal-bottom-stacked");

    // When: close the active terminal.
    await panel.getByTestId("terminal-close").click();
    // Then: the other pane of the group stays and keeps working.
    await expect(pane("t4")).toHaveCount(0);
    await expect(panel).toHaveAttribute("data-active-terminal", "t3");
    await expect(list.getByTestId("terminal-row")).toHaveText(["Terminal 1", "Terminal 2", "Terminal 3"]);
    await focus("t3");
    await command(output("t3"), "Write-Output 'three-ok'", "three-ok");

    // When: back to the first group, then move the panel to the side.
    await list.locator('[data-testid="terminal-row"][data-terminal-id="t1"]').click();
    await expect(pane("t1")).toHaveAttribute("data-running", "true");
    await panel.getByTestId("terminal-placement").click();
    // Then: the side panel hosts the same shells, output replayed.
    await expect(panel).toHaveAttribute("data-placement", "docked");
    await expect(page.getByTestId("terminal-drawer")).toHaveCount(0);
    await expect(page.getByTestId("right-tab-terminal")).toHaveAttribute("aria-selected", "true");
    await expect(pane("t1")).toHaveAttribute("data-running", "true");
    await expect(pane("t2")).toHaveAttribute("data-running", "true");
    await expect.poll(() => lines("t1")).toContain("one-ok");
    await focus("t1");
    await command(output("t1"), '"side-$who"', "side-first");
    await shot(page, "terminal-side");
    // A narrow window floats the side panel over the conversation.
    await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(700, 900));
    await expect(panel).toHaveAttribute("data-placement", "overlay");
    await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
    await expect(panel).toHaveAttribute("data-placement", "docked");

    // When: back to the bottom; the toggle closes and reopens it there.
    await panel.getByTestId("terminal-placement").click();
    // Then
    await expect(panel).toHaveAttribute("data-placement", "bottom");
    await expect(page.getByTestId("right-dock")).toHaveCount(0);
    await focus("t2");
    await command(output("t2"), '"back-$who"', "back-second");
    await page.keyboard.press("Control+Backquote");
    await expect(panel).toHaveCount(0);
    await page.keyboard.press("Control+Backquote");
    await expect(panel).toHaveAttribute("data-placement", "bottom");
    await expect(pane("t2")).toHaveAttribute("data-running", "true");
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
