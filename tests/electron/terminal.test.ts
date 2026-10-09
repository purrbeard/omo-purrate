import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TerminalChunk, TerminalExit } from "../../shared/workbench";
import { WORKBENCH_IPC } from "../../shared/workbench";
import { createTerminals } from "../../electron/workbench/terminal";

function event<T>(events: EventEmitter, channel: string, matches: (value: T) => boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const listener = (value: T) => {
      if (!matches(value)) return;
      clearTimeout(timer);
      events.off(channel, listener);
      resolve(value);
    };
    const timer = setTimeout(() => {
      events.off(channel, listener);
      reject(new Error(`No ${channel} event within 10 seconds`));
    }, 10_000);
    events.on(channel, listener);
  });
}

describe("workbench terminals", () => {
  it("bounds retained chunks and bytes while forwarding complete stream chunks", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "omo-terminal-buffer-"));
    let child: ChildProcessWithoutNullStreams | undefined;
    let latest: TerminalChunk | TerminalExit | undefined;
    const terminals = createTerminals({
      getLoginEnv: async () => Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      spawnImpl: (command, args, options) => {
        child = spawn(command, args, options);
        return child;
      },
      send: (_channel, payload) => { latest = payload; },
    });
    try {
      await terminals.terminalOpen("buffer", cwd);
      for (let index = 0; index < 450; index += 1) child!.stdout.emit("data", `chunk-${index}\n`);
      let snapshot = await terminals.terminalOpen("buffer", cwd);
      expect(snapshot.output).toHaveLength(400);
      expect(snapshot.output[0]?.text).toBe("chunk-50\n");
      const large = "a".repeat(300_000);
      child!.stdout.emit("data", large);
      expect(latest).toMatchObject({ stream: "stdout", text: large });
      snapshot = await terminals.terminalOpen("buffer", cwd);
      expect(snapshot.output.reduce((bytes, chunk) => bytes + chunk.text.length * 2, 0)).toBeLessThanOrEqual(200 * 1024);
      expect(snapshot.output.at(-1)?.text).toHaveLength(100 * 1024);
    } finally {
      await terminals.dispose();
    }
  }, 20_000);

  it("streams real shell output with stdin open, reuses snapshots and kills the shell", async () => {
    const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), "omo-terminal-")));
    const events = new EventEmitter();
    const terminals = createTerminals({
      getLoginEnv: async () => Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      send: (channel, payload) => events.emit(channel, payload),
    });
    try {
      const [opened, concurrent] = await Promise.all([terminals.terminalOpen("thread", cwd), terminals.terminalOpen("thread", cwd)]);
      expect(opened).toMatchObject({ threadId: "thread", cwd, running: true });
      expect(concurrent).toEqual(opened);
      const output = event<TerminalChunk>(events, WORKBENCH_IPC.terminalChunk, (chunk) => chunk.threadId === "thread" && chunk.stream === "stdout" && /workbench-ok\r?\n/u.test(chunk.text));
      await terminals.terminalWrite("thread", "echo workbench-ok");
      expect((await output).text).toContain("workbench-ok");
      const snapshot = await terminals.terminalOpen("thread", cwd);
      expect(snapshot.output.some((chunk) => chunk.text.includes("workbench-ok"))).toBe(true);
      const exit = event<TerminalExit>(events, WORKBENCH_IPC.terminalExit, (value) => value.threadId === "thread");
      await terminals.terminalKill("thread");
      expect((await exit).threadId).toBe("thread");
      await expect(terminals.terminalWrite("thread", "echo after")).rejects.toThrow(/not running/);
      await expect(terminals.terminalOpen("../bad", cwd)).rejects.toThrow(/thread id/);
      await expect(terminals.terminalOpen("valid", ".")).rejects.toThrow(/absolute/);
      await expect(terminals.terminalWrite("unknown", "hello")).rejects.toThrow(/not running/);
      await expect(terminals.terminalWrite("thread", 1)).rejects.toThrow(/string/);
      await expect(terminals.terminalWrite("thread", "a".repeat(8001))).rejects.toThrow(/8000/);
    } finally {
      await terminals.dispose();
    }
    await expect(terminals.terminalOpen("thread", cwd)).rejects.toThrow(/disposed/);
  }, 20_000);
});
