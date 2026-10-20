import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NativeCommandError } from "../../electron/omo/native/connection";
import { parsePsStartTimes, parseWindowsStartTimes, SessionHolders } from "../../electron/omo/session-holders";
import type { StartTimes } from "../../electron/omo/session-holders";
import { parseSessionHeld } from "../../shared/session-held";

const ID = "019da000-0000-7000-8000-000000000001";

async function sessionWithHolders(records: Record<number, { processStartedAtMs: number; cwd?: string }>): Promise<{ id: string; sessionPath: string }> {
  const project = await mkdtemp(path.join(os.tmpdir(), "omo-holders-"));
  const directory = path.join(project, "session-holders", ID);
  await mkdir(directory, { recursive: true });
  for (const [pid, record] of Object.entries(records)) await writeFile(path.join(directory, `${pid}.json`), JSON.stringify({ pid: Number(pid), bootAtMs: 1, ...record }));
  await writeFile(path.join(directory, "notes.txt"), "not a holder");
  await writeFile(path.join(directory, "999.json"), "{ truncated");
  return { id: ID, sessionPath: path.join(project, `${ID}.jsonl`) };
}

const starts = (live: Record<number, number>): StartTimes => async (pids) => new Map(pids.flatMap((pid) => (live[pid] === undefined ? [] : [[pid, live[pid]!] as const])));

describe("SessionHolders", () => {
  it("keeps a live holder, drops a reused pid and a dead pid, and excludes our own processes", async () => {
    const session = await sessionWithHolders({
      100: { processStartedAtMs: 1_000_000, cwd: "P:\\work" },
      200: { processStartedAtMs: 1_000_000 },
      300: { processStartedAtMs: 1_000_000 },
      400: { processStartedAtMs: 1_000_000 },
      500: { processStartedAtMs: 1_000_000 },
    });
    const holders = new SessionHolders({ ownPids: () => [400, null, 500], startTimes: starts({ 100: 1_000_900, 200: 7_000_000, 400: 1_000_000, 500: 1_000_000 }) });
    expect(await holders.lookup([session])).toEqual({ [ID]: [{ pid: 100, cwd: "P:\\work" }] });
  });

  it("omits a session nobody holds and one with no holder directory", async () => {
    const session = await sessionWithHolders({ 100: { processStartedAtMs: 1 } });
    const holders = new SessionHolders({ ownPids: () => [], startTimes: starts({}) });
    expect(await holders.lookup([session, { id: "none", sessionPath: path.join(os.tmpdir(), "no-such-project", "none.jsonl") }])).toEqual({});
  });

  it("asks for process start times once per cache window", async () => {
    const session = await sessionWithHolders({ 100: { processStartedAtMs: 5_000 } });
    let calls = 0;
    let now = 0;
    const holders = new SessionHolders({
      ownPids: () => [], ttlMs: 10_000, now: () => now,
      startTimes: async (pids) => { calls += 1; return starts({ 100: 5_000 })(pids); },
    });
    await holders.lookup([session]);
    now = 9_000;
    await holders.lookup([session]);
    expect(calls).toBe(1);
    now = 11_000;
    await holders.lookup([session]);
    expect(calls).toBe(2);
  });
});

describe("process start time parsing", () => {
  it("reads the PowerShell and ps outputs", () => {
    expect([...parseWindowsStartTimes("65112 1792456324283\r\nnoise\r\n7 12\r\n")]).toEqual([[65112, 1792456324283], [7, 12]]);
    expect(parsePsStartTimes("  42 Mon Oct 20 12:34:56 2026\n").get(42)).toBe(new Date("Mon Oct 20 12:34:56 2026").getTime());
  });
});

describe("session_held refusal", () => {
  it("carries the holders in the error message across the IPC bridge", () => {
    const error = new NativeCommandError("open_session", "session is held", "session_held", {
      holders: [{ pid: 65112, cwd: "P:\\coding", host_socket: "s", host_instance: "i" }, { nope: true }],
    });
    expect(error.errorCode).toBe("session_held");
    // Electron's invoke wrapper and the preload add their own prefixes before the renderer sees the message.
    const seen = `Error: -32600: ${error.message}`;
    expect(parseSessionHeld(seen)).toEqual([{ pid: 65112, cwd: "P:\\coding", hostSocket: "s", hostInstance: "i" }]);
  });

  it("leaves other refusals and other messages alone", () => {
    expect(new NativeCommandError("x", "no such model", "bad_model", undefined).message).toBe("no such model");
    expect(parseSessionHeld("-32600: no such model")).toBeNull();
  });
});
