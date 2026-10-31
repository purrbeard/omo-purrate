import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { processStartTimes, SessionHolders } from "../../electron/omo/session-holders";
import type { ObserveProcessExit } from "../../electron/omo/session-holders";

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("ownership event did not arrive")), 15000); })]);
  } finally { clearTimeout(timer); }
}
async function seed(pid: number, startedAtMs: number) {
  const project = await mkdtemp(path.join(os.tmpdir(), "holder-event-"));
  const directory = path.join(project, "session-holders", "owner");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${pid}.json`);
  await writeFile(file, JSON.stringify({ pid, processStartedAtMs: startedAtMs, bootAtMs: 1 }));
  return { project, directory, file, session: { id: "owner", sessionPath: path.join(project, "owner.jsonl") } };
}

describe("SessionHolders event lifecycle", () => {
  it("receives a real holder-directory release rename without a timer or focus event", async () => {
    const fixture = await seed(123, 1000);
    const event = signal();
    const holders = new SessionHolders({ ownPids: () => [], startTimes: async () => new Map([[123, { startedAtMs: 1000, parentPid: null }]]), observeExit: () => () => {} });
    const stop = holders.watch(fixture.session.sessionPath, event.resolve);
    try {
      expect((await holders.lookup([fixture.session]))["owner"]).toHaveLength(1);
      await rename(fixture.directory, path.join(fixture.project, "released-holder-evidence"));
      await bounded(event.promise);
      expect(await holders.lookup([fixture.session])).toEqual({});
    } finally { stop(); }
  });
  it("invalidates the cached process identity on the exact exit signal and unsubscribes on disposal", async () => {
    const fixture = await seed(123, 1000);
    let live = true;
    let disposed = false;
    let exited = () => {};
    const observeExit: ObserveProcessExit = (_pid, _startedAtMs, callback) => { exited = callback; return () => { disposed = true; }; };
    const event = signal();
    const holders = new SessionHolders({ ownPids: () => [], ttlMs: 100000, observeExit, startTimes: async () => live ? new Map([[123, { startedAtMs: 1000, parentPid: null }]]) : new Map() });
    const stop = holders.watch(fixture.session.sessionPath, event.resolve);
    try {
      expect((await holders.lookup([fixture.session]))["owner"]).toHaveLength(1);
      live = false;
      exited();
      await bounded(event.promise);
      expect(await holders.lookup([fixture.session])).toEqual({});
      expect(disposed).toBe(true);
    } finally { stop(); }
  });
  it.runIf(process.platform === "win32")("observes an actual child exit with its stale lease unchanged", async () => {
    const child = spawn(process.execPath, ["-e", "process.stdout.write('READY\\n'); process.stdin.resume(); process.stdin.once('data', () => process.exit(0));"], { windowsHide: true, stdio: "pipe" });
    const ready = new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.stdout.once("data", chunk => String(chunk).trim() === "READY" ? resolve() : reject(new Error("unexpected child greeting")));
    });
    const childExit = new Promise<void>((resolve, reject) => child.once("exit", code => code === 0 ? resolve() : reject(new Error(`fixture exited ${code}`))));
    let stop = () => {};
    try {
      await bounded(ready);
      const pid = child.pid!;
      const startedAtMs = (await processStartTimes([pid])).get(pid)?.startedAtMs;
      expect(startedAtMs).toBeTypeOf("number");
      const fixture = await seed(pid, startedAtMs!);
      const before = await readFile(fixture.file, "utf8");
      const changed = signal();
      const holders = new SessionHolders({ ownPids: () => [] });
      stop = holders.watch(fixture.session.sessionPath, changed.resolve);
      expect((await holders.lookup([fixture.session]))["owner"]).toHaveLength(1);
      child.stdin.write("exit\n");
      await bounded(changed.promise);
      await bounded(childExit);
      expect(await readFile(fixture.file, "utf8")).toBe(before);
      expect(await holders.lookup([fixture.session])).toEqual({});
    } finally {
      stop();
      child.stdin.end();
    }
  });
});
