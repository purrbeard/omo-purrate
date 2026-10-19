import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalChunk, TerminalExit } from "../../shared/workbench";
import { createTerminals } from "../../electron/workbench/terminal";
import type { TerminalPty } from "../../electron/workbench/terminal";
import { resolveTerminalShell } from "../../electron/workbench/terminal-shell";

type PtyExit = Parameters<Parameters<TerminalPty["onExit"]>[0]>[0];

class FakePty implements TerminalPty {
  readonly pid = 12345;
  readonly write = vi.fn<(data: string) => void>();
  readonly resize = vi.fn<(cols: number, rows: number) => void>();
  readonly dataListeners = new Set<(data: string) => void>();
  readonly exitListeners = new Set<(event: PtyExit) => void>();
  readonly kill = vi.fn(() => this.exit(0));
  onData(listener: (data: string) => void) { this.dataListeners.add(listener); return { dispose: () => this.dataListeners.delete(listener) }; }
  onExit(listener: (event: PtyExit) => void) { this.exitListeners.add(listener); return { dispose: () => this.exitListeners.delete(listener) }; }
  data(text: string): void { for (const listener of this.dataListeners) listener(text); }
  exit(exitCode: number): void { for (const listener of [...this.exitListeners]) listener({ exitCode }); }
}

describe("terminal shell resolution", () => {
  const env = { PATH: "C:\\Tools;C:\\Legacy", SystemRoot: "C:\\Windows", ComSpec: "C:\\Custom\\cmd.exe" };
  const chain = ["C:\\Override\\pwsh.exe", "C:\\Tools\\pwsh.exe", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "C:\\Legacy\\powershell.exe", "C:\\Custom\\cmd.exe", "C:\\Windows\\System32\\cmd.exe"];
  it.each(chain.map((file, index) => ({ file, available: chain.slice(index) })))("uses $file when earlier Windows shells are absent", async ({ file, available }) => {
    // Given
    const exists = async (candidate: string): Promise<boolean> => available.includes(candidate);
    // When
    const shell = await resolveTerminalShell({ platform: "win32", env, override: chain[0], exists });
    // Then
    expect(shell.file).toBe(file);
    expect(shell.args).toEqual(/powershell|pwsh/u.test(file) ? ["-NoLogo", "-NoExit", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8"] : []);
  });
  it.each(["/custom/shell", "/bin/zsh", "/bin/bash", "/bin/sh"])("uses %s when earlier Unix shells are absent", async file => {
    // Given
    const exists = async (candidate: string): Promise<boolean> => candidate === file;
    // When
    const shell = await resolveTerminalShell({ platform: "linux", env: { SHELL: "/custom/shell" }, exists });
    // Then
    expect(shell).toEqual({ file, args: [] });
  });
});

describe("workbench PTY terminals", () => {
  let cwd: string;
  let pty: FakePty;
  let sent: Array<TerminalChunk | TerminalExit>;
  let terminals: ReturnType<typeof createTerminals>;
  let spawnImpl: ReturnType<typeof vi.fn<NonNullable<Parameters<typeof createTerminals>[0]["spawnImpl"]>>>;
  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), "omo-terminal-")));
    pty = new FakePty();
    sent = [];
    spawnImpl = vi.fn(() => pty);
    terminals = createTerminals({ getLoginEnv: async () => Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), spawnImpl, send: (_channel, value) => sent.push(value) });
  });
  it("deduplicates concurrent opens and preserves the workspace", async () => {
    // Given / When
    const [first, second] = await Promise.all([terminals.terminalOpen("thread", "t1", cwd), terminals.terminalOpen("thread", "t1", cwd)]);
    // Then
    expect(second).toEqual(first);
    expect(spawnImpl).toHaveBeenCalledExactlyOnceWith(expect.any(String), expect.any(Array), expect.objectContaining({ cwd, cols: 80, rows: 24 }));
    await terminals.dispose();
  });
  it("keeps several shells per thread apart by terminal id", async () => {
    // Given
    const second = new FakePty();
    spawnImpl.mockImplementationOnce(() => pty).mockImplementationOnce(() => second);
    await terminals.terminalOpen("thread", "t1", cwd);
    await terminals.terminalOpen("thread", "t2", cwd);
    // When
    await terminals.terminalWrite("thread", "t2", "dir\r");
    second.data("second-out");
    await terminals.terminalKill("thread", "t1");
    // Then
    expect(spawnImpl).toHaveBeenCalledTimes(2);
    expect(pty.write).not.toHaveBeenCalled();
    expect(second.write).toHaveBeenCalledExactlyOnceWith("dir\r");
    expect(sent).toContainEqual({ threadId: "thread", terminalId: "t2", sequence: 1, stream: "stdout", text: "second-out" });
    expect(sent).toContainEqual({ threadId: "thread", terminalId: "t1", code: 0 });
    expect(second.kill).not.toHaveBeenCalled();
    await expect(terminals.terminalWrite("thread", "t1", "x")).rejects.toThrow(/not running/);
    expect((await terminals.terminalOpen("thread", "t2", cwd)).running).toBe(true);
    await terminals.dispose();
    expect(second.kill).toHaveBeenCalledTimes(1);
  });
  it("forwards raw control data without inserting a newline", async () => {
    // Given
    await terminals.terminalOpen("thread", "t1", cwd);
    // When
    await terminals.terminalWrite("thread", "t1", "한글\u001b\u000c\r");
    // Then
    expect(pty.write).toHaveBeenCalledExactlyOnceWith("한글\u001b\u000c\r");
    await terminals.dispose();
  });
  it("resizes the running PTY", async () => {
    // Given
    await terminals.terminalOpen("thread", "t1", cwd);
    // When
    await terminals.terminalResize("thread", "t1", 132, 40);
    // Then
    expect(pty.resize).toHaveBeenCalledExactlyOnceWith(132, 40);
    await terminals.dispose();
  });
  it.each([[0, 24], [80, -1], [1.5, 24], [1001, 24], [80, Infinity], ["80", 24]])("rejects invalid dimensions %s by %s", async (cols, rows) => {
    // Given
    await terminals.terminalOpen("thread", "t1", cwd);
    // When / Then
    await expect(terminals.terminalResize("thread", "t1", cols, rows)).rejects.toThrow(/positive integers/);
    expect(pty.resize).not.toHaveBeenCalled();
    await terminals.dispose();
  });
  it("caps raw replay while forwarding the complete original data", async () => {
    // Given
    await terminals.terminalOpen("thread", "t1", cwd);
    const text = "한글\u001b[31m" + "a".repeat(300_000);
    // When
    pty.data(text);
    const replay = await terminals.terminalOpen("thread", "t1", cwd);
    // Then
    expect(sent).toContainEqual({ threadId: "thread", terminalId: "t1", sequence: 1, stream: "stdout", text });
    expect(replay.output.map(chunk => chunk.text).join("")).toBe(text.slice(-100 * 1024));
    expect(replay.sequence).toBe(1);
    await terminals.dispose();
  });
  it("kills once, publishes exit, and rejects input after termination", async () => {
    // Given
    await terminals.terminalOpen("thread", "t1", cwd);
    // When
    await Promise.all([terminals.terminalKill("thread", "t1"), terminals.terminalKill("thread", "t1")]);
    // Then
    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(sent).toContainEqual({ threadId: "thread", terminalId: "t1", code: 0 });
    await expect(terminals.terminalWrite("thread", "t1", "x")).rejects.toThrow(/not running/);
    expect(pty.dataListeners.size).toBe(0);
    await terminals.dispose();
  });
  it("disposes all sessions and prevents new shells", async () => {
    // Given
    await terminals.terminalOpen("thread", "t1", cwd);
    // When
    await terminals.dispose();
    // Then
    expect(pty.kill).toHaveBeenCalledTimes(1);
    await expect(terminals.terminalOpen("thread", "t1", cwd)).rejects.toThrow(/disposed/);
  });
  it("escalates when PTY kill throws without leaving killing stuck", async () => {
    // Given
    const killTree = vi.fn(async () => {});
    pty.kill.mockImplementation(() => { throw new Error("native kill failed"); });
    terminals = createTerminals({ getLoginEnv: async () => ({ ...process.env, PATH: process.env["PATH"] ?? "" }), spawnImpl, send: (_channel, value) => sent.push(value), killTree });
    await terminals.terminalOpen("thread", "t1", cwd);
    // When
    await terminals.terminalKill("thread", "t1");
    // Then
    expect(killTree).toHaveBeenCalledExactlyOnceWith(pty.pid);
    expect(sent).toContainEqual({ threadId: "thread", terminalId: "t1", code: -1 });
    await expect(terminals.terminalWrite("thread", "t1", "x")).rejects.toThrow(/not running/);
    await terminals.dispose();
  });
  it("bounds disposal and tree kills when the PTY never publishes exit", async () => {
    // Given
    const killTree = vi.fn(async () => {});
    pty.kill.mockImplementation(() => {});
    terminals = createTerminals({ getLoginEnv: async () => Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), spawnImpl, send: (_channel, value) => sent.push(value), killTree });
    await terminals.terminalOpen("thread", "t1", cwd);
    vi.useFakeTimers();
    try {
      // When
      const disposal = terminals.dispose();
      await vi.advanceTimersByTimeAsync(1000);
      await disposal;
      // Then
      expect(killTree).toHaveBeenCalledExactlyOnceWith(pty.pid);
      expect(sent).toContainEqual({ threadId: "thread", terminalId: "t1", code: -1 });
    } finally { vi.useRealTimers(); }
  });
  it("stops and clears sessions even when the forced kill exceeds its bound", async () => {
    // Given
    const killTree = vi.fn(() => new Promise<void>(() => {}));
    pty.kill.mockImplementation(() => {});
    terminals = createTerminals({ getLoginEnv: async () => Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), spawnImpl, send: (_channel, value) => sent.push(value), killTree });
    await terminals.terminalOpen("thread", "t1", cwd);
    vi.useFakeTimers();
    try {
      // When
      const disposal = terminals.dispose();
      await vi.advanceTimersByTimeAsync(2000);
      await disposal;
      // Then
      expect(sent).toContainEqual({ threadId: "thread", terminalId: "t1", code: -1 });
      expect(pty.dataListeners.size).toBe(0);
      await expect(terminals.terminalWrite("thread", "t1", "x")).rejects.toThrow(/not running/);
    } finally { vi.useRealTimers(); }
  });
  it("validates IDs, workspace and raw input at the IPC boundary", async () => {
    // Given / When / Then
    await expect(terminals.terminalOpen("../bad", "t1", cwd)).rejects.toThrow(/thread id/);
    await expect(terminals.terminalOpen("thread", "t/1", cwd)).rejects.toThrow(/terminal id/);
    await expect(terminals.terminalOpen("thread", "t1", ".")).rejects.toThrow(/absolute/);
    await expect(terminals.terminalWrite("thread", "t1", 1)).rejects.toThrow(/string/);
    await expect(terminals.terminalWrite("thread", "t1", "a".repeat(8001))).rejects.toThrow(/8000/);
    await expect(terminals.terminalWrite("missing", "t1", "x")).rejects.toThrow(/not running/);
    await terminals.dispose();
  });
});
