import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeAppServerClient } from "../../electron/omo/native/client";
import { SessionHolders } from "../../electron/omo/session-holders";

const host = vi.hoisted(() => ({
  frames: [] as Array<{ command: string; fields: Record<string, unknown> }>,
  listeners: new Set<(record: Record<string, unknown> & { type: string }) => void>(),
  promptListeners: new Set<() => void>(),
  streaming: false,
  resume: null as null | (() => Promise<unknown>),
}));
vi.mock("../../electron/omo/native/connection", async (original) => {
  const actual = await original<typeof import("../../electron/omo/native/connection")>();
  return { ...actual, NativeConnection: class {
    pid = null;
    start(): void {}
    async send(command: string, fields: Record<string, unknown>): Promise<unknown> {
      host.frames.push({ command, fields });
      if (command === "get_protocol_info") return { mode: "multi", serverVersion: "5.1.54" };
      if (command === "open_session") return { sessionId: "rpc-1", state: { sessionId: "thread-1", cwd: process.cwd() } };
      if (command === "get_state") return { isStreaming: host.streaming };
      if (command === "prompt") {
        host.streaming = true;
        for (const listener of host.promptListeners) listener();
      }
      if (command === "abort") host.streaming = false;
      if (command === "resume_session" && host.resume !== null) return host.resume();
      return {};
    }
    write(): void {}
    onRecord(listener: (record: Record<string, unknown> & { type: string }) => void): () => void { host.listeners.add(listener); return () => host.listeners.delete(listener); }
    onMalformed(): () => void { return () => {}; }
    onExit(): () => void { return () => {}; }
    async stop(): Promise<void> {}
  } };
});
afterEach(() => { host.frames.length = 0; host.listeners.clear(); host.promptListeners.clear(); host.streaming = false; host.resume = null; });

async function open(holdInputWhileRunning = false, socket?: string): Promise<NativeAppServerClient> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ownership-native-"));
  const client = new NativeAppServerClient({ command: "omo", args: [], cwd: directory, env: {}, agentDir: directory, stateDir: directory, clientVersion: "test", holdInputWhileRunning, ...(socket === undefined ? {} : { socket }) });
  await client.start();
  await client.request("thread/start", { cwd: directory });
  return client;
}
const input = (text: string) => [{ type: "text" as const, text, text_elements: [] }];
function settle(): void {
  host.streaming = false;
  for (const listener of host.listeners) listener({ type: "agent_settled", sessionId: "rpc-1" });
}

describe("native .54 user authority", () => {
  it("keeps an admitted socket handle's Stop authority independent of CIM discovery", async () => {
    const client = await open(false, "P:\\rpc\\shared.sock");
    const lookup = vi.spyOn(SessionHolders.prototype, "lookup").mockRejectedValue(new Error("CIM unavailable"));
    try {
      const { turn } = await client.request("turn/start", { threadId: "thread-1", input: input("go") });
      await expect(client.request("turn/interrupt", { threadId: "thread-1", turnId: turn.id })).resolves.toEqual({});
      expect(lookup).not.toHaveBeenCalled();
    } finally { lookup.mockRestore(); await client.stop(); }
  });
  it.each(["thread/delete", "thread/archive", "thread/unarchive"] as const)("refuses %s on a shared host before closing any attachment or touching disk", async method => {
    const client = await open(false, "P:\\rpc\\shared.sock");
    const before = host.frames.length;
    await expect(client.request(method, { threadId: "thread-1" })).rejects.toThrow("Session storage changes require a private runtime");
    expect(host.frames.slice(before)).toEqual([]);
    await client.stop();
  });
  it("declares interactive_user on the connection's first client-info handshake", async () => {
    await open();
    expect(host.frames.find(frame => frame.command === "set_client_info")?.fields["capabilities"]).toContain("interactive_user");
  });
  it("uses authoritative Stop intent rather than an ordinary abort", async () => {
    const client = await open();
    const { turn } = await client.request("turn/start", { threadId: "thread-1", input: input("go") });
    await client.request("turn/interrupt", { threadId: "thread-1", turnId: turn.id });
    expect(host.frames.find(frame => frame.command === "abort")?.fields).toMatchObject({ intent: "stop", awaitIdle: true });
  });
  it("keeps delayed input queued after Stop until a new explicit user send", async () => {
    const client = await open(true);
    const { turn } = await client.request("turn/start", { threadId: "thread-1", input: input("go") });
    await client.request("turn/followUp", { threadId: "thread-1", input: input("keep this draft queued") });
    await client.request("turn/interrupt", { threadId: "thread-1", turnId: turn.id });
    settle();
    // An explicit send is the deterministic admission barrier; it must consume, rather than race, the held draft.
    await client.request("turn/start", { threadId: "thread-1", input: input("resume now") });
    expect(host.frames.filter(frame => frame.command === "prompt").map(frame => frame.fields["message"])).toEqual(["go", "keep this draft queued\nresume now"]);
  });
  it("continues automatically with held follow-up after NORMAL completion", async () => {
    const client = await open(true);
    await client.request("turn/start", { threadId: "thread-1", input: input("go") });
    await client.request("turn/followUp", { threadId: "thread-1", input: input("continue normally") });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const prompt = new Promise<void>((resolve, reject) => {
      host.promptListeners.add(resolve);
      timer = setTimeout(() => reject(new Error("normal completion did not deliver held input")), 1000);
    });
    try {
      settle();
      await prompt;
      expect(host.frames.filter(frame => frame.command === "prompt").map(frame => frame.fields["message"])).toEqual(["go", "continue normally"]);
    } finally { clearTimeout(timer); }
  });
  it("keeps a newer Stop intact and transfers queued input atomically with Resume", async () => {
    const client = await open(true);
    try {
      const { turn } = await client.request("turn/start", { threadId: "thread-1", input: input("go") });
      await client.request("turn/followUp", { threadId: "thread-1", input: input("keep queued") });
      await client.request("turn/interrupt", { threadId: "thread-1", turnId: turn.id });
      host.resume = async () => {
        for (const listener of host.listeners) listener({ type: "session_resumed", sessionId: "rpc-1", pauseSeq: 1 });
        for (const listener of host.listeners) listener({ type: "session_paused", sessionId: "rpc-1", pauseSeq: 2 });
        return { resumed: true, pauseSeq: 1, turnStarted: false };
      };
      await client.request("thread/execution/resume", { threadId: "thread-1", effectId: "older-resume", expectedSeq: 1 });
      expect(host.frames.filter(frame => frame.command === "prompt").map(frame => frame.fields["message"])).toEqual(["go"]);
      expect(host.frames.find(frame => frame.command === "resume_session")?.fields).toMatchObject({ message: "keep queued", mode: "continue", expectedSeq: 1 });
      host.resume = null;
      await client.request("turn/start", { threadId: "thread-1", input: input("explicit later send") });
      // The native held-input ledger now owns the draft; sending it again would duplicate it.
      expect(host.frames.filter(frame => frame.command === "prompt").at(-1)?.fields["message"]).toBe("explicit later send");
    } finally { await client.stop(); }
  });
});

describe("foreign holder discovery", () => {
  async function seed(): Promise<{ id: string; sessionPath: string }> {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ownership-holder-"));
    const folder = path.join(directory, "session-holders", "foreign");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "100.json"), JSON.stringify({ pid: 100, bootAtMs: 20, processStartedAtMs: 1000, cwd: "P:\\foreign", host_socket: "P:\\rpc\\host.sock", host_instance: "instance-1" }));
    return { id: "foreign", sessionPath: path.join(directory, "foreign.jsonl") };
  }
  it("preserves verified process and endpoint identity for cooperative release", async () => {
    const session = await seed();
    const holders = new SessionHolders({ ownPids: () => [], startTimes: async () => new Map([[100, { startedAtMs: 1000, parentPid: null }]]) });
    expect((await holders.lookup([session]))["foreign"]?.[0]).toMatchObject({ pid: 100, processStartedAtMs: 1000, bootAtMs: 20, hostSocket: "P:\\rpc\\host.sock", hostInstance: "instance-1", identity: "verified" });
  });
  it("keeps a process whose liveness query failed read-only and unverified", async () => {
    const session = await seed();
    const holders = new SessionHolders({ ownPids: () => [], startTimes: async () => { throw new Error("CIM unavailable"); } });
    expect(await holders.lookup([session])).toMatchObject({ foreign: [{ pid: 100, identity: "unverified" }] });
  });
});
