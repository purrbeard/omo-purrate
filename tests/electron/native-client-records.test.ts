import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeRecord } from "../../electron/omo/native/connection";
import { NativeAppServerClient } from "../../electron/omo/native/client";
import type { RpcNotification } from "../../shared/protocol";

// The client is driven through a scripted connection, so a test can inject any record omo could send.
const host = vi.hoisted(() => ({
  sent: [] as string[],
  listeners: new Set<(record: Record<string, unknown> & { type: string }) => void>(),
  failures: new Map<string, Error>(),
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
  });
});
