import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeRecord } from "../../electron/omo/native/connection";
import { NativeAppServerClient } from "../../electron/omo/native/client";
import { TurnProjector } from "../../electron/omo/native/projector";
import { fromWireTurn } from "../../src/state/conversation";
import { createInitialState, reduce } from "../../src/state";
import type { HistoryTurn } from "../../shared/ipc";
import type { RpcNotification, Turn } from "../../shared/protocol";

// The client is driven through a scripted connection, so a test can inject any record omo could send.
const host = vi.hoisted(() => ({
  sent: [] as string[],
  listeners: new Set<(record: Record<string, unknown> & { type: string }) => void>(),
  failures: new Map<string, Error>(),
  stats: {} as Record<string, unknown>,
  opened: false,
  sessionFile: null as string | null,
  /** When set, the next goal-store read waits until the test releases it with the text it returns. */
  holdGoalRead: null as ((release: (text: string) => void) => void) | null,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = ((file: string, ...rest: unknown[]) => {
    const hold = host.holdGoalRead;
    if (hold === null || !String(file).includes(`${path.sep}goal${path.sep}`)) return (original.readFile as (...args: unknown[]) => unknown)(file, ...rest);
    host.holdGoalRead = null;
    return new Promise<string>((resolve) => hold(resolve));
  }) as typeof original.readFile;
  return { ...original, readFile, default: { ...original, readFile } };
});

vi.mock("../../electron/omo/native/connection", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../electron/omo/native/connection")>();
  class ScriptedConnection {
    pid = null;
    hasExited = false;
    stderrTail = "";
    spawnError = null;
    exited = null;
    start(): void {}
    async send(command: string): Promise<unknown> {
      host.sent.push(command);
      const failure = host.failures.get(command);
      if (failure !== undefined) throw failure;
      if (command === "get_session_stats") return host.stats;
      if (command === "open_session") {
        host.opened = true;
        return { sessionId: "handle-1", state: { sessionId: "thread-1", cwd: "/work/project", ...(host.sessionFile === null ? {} : { sessionFile: host.sessionFile }) } };
      }
      return {};
    }
    write(): void {}
    onRecord(listener: (record: Record<string, unknown> & { type: string }) => void): () => void {
      host.listeners.add(listener);
      return () => host.listeners.delete(listener);
    }
    onMalformed(): () => void { return () => {}; }
    onExit(): () => void { return () => {}; }
    async stop(): Promise<void> {}
  }
  return { ...original, NativeConnection: ScriptedConnection };
});

afterEach(() => {
  host.sent.length = 0;
  host.listeners.clear();
  host.failures.clear();
  host.stats = {};
  host.opened = false;
  host.sessionFile = null;
  host.holdGoalRead = null;
  vi.restoreAllMocks();
});

async function open(): Promise<{ client: NativeAppServerClient; seen: RpcNotification[] }> {
  const dir = await mkdtemp(path.join(tmpdir(), "native-records-"));
  const client = new NativeAppServerClient({ command: "omo", args: [], cwd: dir, env: {}, agentDir: dir, stateDir: dir, clientVersion: "test" });
  const seen: RpcNotification[] = [];
  client.onNotification((notification) => seen.push(notification));
  await client.request("thread/start", { cwd: "/work/project" });
  return { client, seen };
}

function deliver(record: NativeRecord): void {
  for (const listener of [...host.listeners]) listener({ sessionId: "handle-1", ...record });
}

const alerts = (seen: RpcNotification[]) => seen.filter((n) => n.method === "thread/alert").map((n) => n.params as Record<string, unknown>);
const methods = (seen: RpcNotification[], method: string) => seen.filter((n) => n.method === method);
const reportedUsage = { input: 10, output: 2, cacheRead: 30, cacheWrite: 0, totalTokens: 42 };

function usageProjection(messages: Array<Record<string, unknown>>): { seen: RpcNotification[]; completed: Turn } {
  const seen: RpcNotification[] = [];
  const projector = new TurnProjector("usage-thread", "/work", n => seen.push(n), () => 1000);
  projector.beginClientTurn([], null);
  for (const message of messages) {
    projector.handle({ type: "message_start", message });
    projector.handle({ type: "message_end", message });
  }
  projector.handle({ type: "agent_end" });
  projector.handle({ type: "agent_settled" });
  const completed = methods(seen, "turn/completed");
  expect(completed).toHaveLength(1);
  return { seen, completed: (completed[0]?.params as { turn: Turn }).turn };
}

describe("native usage transport", () => {
  it("sums tool-use and final assistant usage once and retains it through live reducer completion", () => {
    const { seen, completed } = usageProjection([
      { role: "assistant", responseId: "first", usage: reportedUsage, content: [{ type: "text", text: "working" }], stopReason: "toolUse" },
      { role: "toolResult", usage: { input: 999, output: 999, cacheRead: 999, cacheWrite: 999, totalTokens: 3996 }, content: [] },
      { role: "assistant", responseId: "second", usage: reportedUsage, content: [{ type: "thinking", thinking: "reason" }, { type: "text", text: "done" }], stopReason: "stop" },
    ]);
    const usage = { input: 20, output: 4, cacheRead: 60, cacheWrite: 0, totalTokens: 84 };
    expect(completed.usage).toEqual(usage);
    expect(fromWireTurn(completed, 1000).usage).toEqual(usage);
    let state = createInitialState();
    for (const notification of seen) state = reduce(state, { type: "rpc/notification", notification, receivedAtMs: 1000 });
    expect(state.conversations["usage-thread"]?.turns[0]?.usage).toEqual(usage);
    expect(state.conversations["usage-thread"]?.turns[0]?.items.length).toBeGreaterThan(0);
  });

  it("does not double-count a duplicate assistant message_end", () => {
    const seen: RpcNotification[] = [];
    const projector = new TurnProjector("usage-thread", "/work", n => seen.push(n));
    const message = { role: "assistant", responseId: "same", usage: reportedUsage, content: [], stopReason: "stop" };
    projector.handle({ type: "message_start", message });
    projector.handle({ type: "message_end", message });
    projector.handle({ type: "message_end", message });
    projector.handle({ type: "agent_settled" });
    expect((methods(seen, "turn/completed")[0]?.params as { turn: Turn }).turn.usage).toEqual(reportedUsage);
  });

  it("preserves unknown counters and rejects negative, non-finite and non-numeric counters", () => {
    const partial = usageProjection([
      { role: "assistant", usage: reportedUsage, content: [], stopReason: "toolUse" },
      { role: "assistant", usage: { input: 0, output: Number.NaN, cacheRead: Number.POSITIVE_INFINITY, cacheWrite: -1, totalTokens: "0" }, content: [], stopReason: "stop" },
    ]);
    expect(partial.completed.usage).toEqual({ input: 10, output: null, cacheRead: null, cacheWrite: null, totalTokens: null });
    const missing = usageProjection([
      { role: "assistant", usage: reportedUsage, content: [], stopReason: "toolUse" },
      { role: "assistant", content: [], stopReason: "stop" },
    ]);
    expect(missing.completed.usage).toEqual({ input: null, output: null, cacheRead: null, cacheWrite: null, totalTokens: null });
    expect(usageProjection([]).completed.usage ?? null).toBeNull();
  });

  it.each(["history/loaded", "history/replaced", "history/patched"] as const)("retains usage during %s and page hydration", type => {
    const usage = { ...reportedUsage, totalTokens: null };
    const historyTurn: HistoryTurn = { id: "u", status: "completed", error: null, items: [], startedAt: 1000, completedAt: 2000, usage };
    let state = reduce(createInitialState(), { type: "thread/activated", threadId: "usage-thread" });
    const result = { threadId: "usage-thread", turns: [historyTurn], todo: null, tasks: [] };
    state = reduce(state, type === "history/patched" ? { type, ...result, from: 0, removed: 0, fullFrom: 1 } : { type, ...result });
    expect(state.conversations["usage-thread"]?.turns[0]?.usage).toEqual(usage);
    const expected = state.conversations["usage-thread"]?.turns;
    if (expected === undefined) throw new Error("History did not create a conversation");
    const pageUsage = { ...reportedUsage, input: 25 };
    const pageTurn = { ...historyTurn, usage: pageUsage };
    state = reduce(state, { type: "history/page", threadId: "usage-thread", from: 0, turns: [pageTurn], expected });
    expect(state.conversations["usage-thread"]?.turns[0]?.usage).toEqual(pageUsage);
    const hydrated = state.conversations["usage-thread"]?.turns;
    if (hydrated === undefined) throw new Error("Page removed the conversation");
    state = reduce(state, { type: "history/page", threadId: "usage-thread", from: 0, turns: [pageTurn], expected: hydrated });
    expect(state.conversations["usage-thread"]?.turns[0]?.usage).toEqual(pageUsage);
  });

  it("returns absent session stats as unknown and preserves reported zero", async () => {
    const { client } = await open();
    expect(await client.request("thread/stats", { threadId: "thread-1" })).toEqual({ stats: {
      tokens: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null }, cost: null, contextUsage: null,
    } });
    host.stats = { tokens: { input: 0, output: Number.POSITIVE_INFINITY, cacheRead: -1, cacheWrite: 5, total: 0 }, cost: 0 };
    expect(await client.request("thread/stats", { threadId: "thread-1" })).toEqual({ stats: {
      tokens: { input: 0, output: null, cacheRead: null, cacheWrite: 5, total: 0 }, cost: 0, contextUsage: null,
    } });
  });
});

describe("NativeAppServerClient records", () => {
  it("pins a transcript write failure as an error alert and warns once per extension path and event", async () => {
    const { seen } = await open();
    deliver({ type: "transcript_write_failed", errorMessage: "disk full" });
    expect(alerts(seen)).toMatchObject([{ threadId: "thread-1", level: "error", code: "transcriptWriteFailed", pinned: true, params: { error: "disk full" } }]);

    deliver({ type: "extension_error", extensionPath: "/ext/a.ts", event: "turn_end", error: "boom" });
    const afterFirst = alerts(seen).length;
    expect(alerts(seen).at(-1)).toMatchObject({ level: "warning", code: "extensionError", params: { extension: "/ext/a.ts", event: "turn_end", error: "boom" } });
    deliver({ type: "extension_error", extensionPath: "/ext/a.ts", event: "turn_end", error: "boom again" });
    expect(alerts(seen)).toHaveLength(afterFirst);
    deliver({ type: "extension_error", extensionPath: "/ext/a.ts", event: "other_event", error: "boom" });
    expect(alerts(seen)).toHaveLength(afterFirst + 1);
  });

  it("raises an error alert for the thread when the compact command rejects", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client, seen } = await open();
    host.failures.set("compact", new Error("nothing to compact"));
    const raised = new Promise<void>((resolve) => client.onNotification((n) => { if (n.method === "thread/alert") resolve(); }));
    expect(await client.request("thread/compact/start", { threadId: "thread-1" })).toEqual({});
    await raised;
    expect(alerts(seen)).toMatchObject([{ threadId: "thread-1", level: "error", code: "compactFailed", params: { error: "nothing to compact" } }]);
  });

  it("cancels a pending auto-retry with abort_retry before abort when the turn is interrupted", async () => {
    const { client } = await open();
    const started = await client.request("turn/start", { threadId: "thread-1", input: [{ type: "text", text: "go", text_elements: [] }] });
    deliver({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 800, errorMessage: "529 overloaded" });
    host.sent.length = 0;
    await client.request("turn/interrupt", { threadId: "thread-1", turnId: started.turn.id });
    expect(host.sent).toEqual(["abort_retry", "abort"]);
  });

  it("announces MCP startup status after open_session resolves and again on agent_settled", async () => {
    const { seen } = await open();
    expect(host.opened).toBe(true);
    expect(methods(seen, "mcpServer/startupStatus/updated")).toMatchObject([{ params: { threadId: "thread-1" } }]);
    deliver({ type: "agent_settled" });
    expect(methods(seen, "mcpServer/startupStatus/updated")).toHaveLength(2);
  });

  it("publishes only the latest goal-store read, so a slow read of a goal never lands after its clear", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "native-goal-"));
    host.sessionFile = path.join(dir, "thread-1.jsonl");
    const store = path.join(dir, "extensions", "goal", "thread-1.json");
    await mkdir(path.dirname(store), { recursive: true });
    const text = JSON.stringify({ version: 1, goal: { id: "g", threadId: "thread-1", objective: "Ship", status: "active", tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1 } });
    await writeFile(store, text);
    const { client, seen } = await open();
    const next = () => new Promise<string>((resolve) => client.onNotification((n) => { if (n.method.startsWith("thread/goal/")) resolve(n.method); }));
    const published = next();
    deliver({ type: "agent_end" });
    expect(await published).toBe("thread/goal/updated");

    let release: (text: string) => void = () => {};
    const held = new Promise<void>((resolve) => { host.holdGoalRead = (resume) => { release = resume; resolve(); }; });
    deliver({ type: "tool_execution_end" });
    await held;
    await rm(store);
    const cleared = next();
    deliver({ type: "agent_end" });
    expect(await cleared).toBe("thread/goal/cleared");
    release(text);
    // The released read resumes on microtasks only; one macrotask turn lets it finish before the assertion.
    await new Promise((resolve) => setImmediate(resolve));
    const goals = seen.filter((n) => n.method.startsWith("thread/goal/")).map((n) => n.method);
    expect(goals).toEqual(["thread/goal/updated", "thread/goal/cleared"]);
  });

  it("emits skills/changed for commands_changed and loaded_surfaces_changed", async () => {
    const { seen } = await open();
    deliver({ type: "commands_changed" });
    deliver({ type: "loaded_surfaces_changed" });
    expect(methods(seen, "skills/changed")).toEqual([{ method: "skills/changed", params: {} }, { method: "skills/changed", params: {} }]);
    expect(methods(seen, "mcpServer/startupStatus/updated")).toMatchObject([
      { params: { threadId: "thread-1" } }, { params: { threadId: "thread-1" } },
    ]);
  });
});
