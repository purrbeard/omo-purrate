import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpawnImpl } from "../../electron/omo/app-server-client";
import { parseSessionTree, readSessionTree, runSessionTree, SessionTreeRpcError } from "../../electron/omo/session-tree";
import type { SessionTreeOptions } from "../../electron/omo/session-tree";
import treeSelectionExtension from "../../electron/omo/tree-selection-extension";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

type Frame = Record<string, unknown>;
const entry = (id: string, parentId: string | null, role: string, content: unknown = id): Frame => ({ type: "message", id, parentId, message: { role, content } });
const custom = (id: string, parentId: string): Frame => ({ type: "custom", customType: "omoui.tree.selection", id, parentId, data: {} });

it("keeps an assistant as branch representative when runtime notices follow it", () => {
  const source = [entry("u", null, "user", "question"), entry("a", "u", "assistant", "answer"),
    { type: "custom_message", customType: "omo-model-profile:unavailable", id: "notice-tail", parentId: "a", content: "profile unavailable" }].map(value => JSON.stringify(value)).join("\n");
  expect(parseSessionTree(source).branches).toEqual([{ entryId: "a", label: "answer", active: true }]);
});
const node = (value: Frame, children: Frame[] = []): Frame => ({ entry: value, children });
const tree = {
  leafId: "persisted",
  tree: [node(entry("u1", null, "user"), [
    node(entry("original", "u1", "assistant", [{ type: "text", text: "원래 응답" }]), [node(custom("bookkeeping", "original"))]),
    node(entry("edited", "u1", "user", "edited prompt"), [node(custom("persisted", "edited"))]),
    node({ type: "custom_message", id: "notice", parentId: "u1", content: "visible notice" }),
  ])],
};

function fakeRunner(handle: (frame: Frame, reply: (data: unknown) => void, child: ChildProcessWithoutNullStreams) => void, ignoreEnd = false) {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const frames: Frame[] = [];
  let exited = false;
  const exit = (code: number | null, signal: string | null): void => {
    if (exited) return;
    exited = true;
    stdout.end();
    stderr.end();
    emitter.emit("exit", code, signal);
    emitter.emit("close", code, signal);
  };
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      const frame: Frame = JSON.parse(String(chunk));
      frames.push(frame);
      queueMicrotask(() => handle(frame, (data) => {
        const bytes = Buffer.from(`${JSON.stringify({ id: frame["id"], type: "response", command: frame["type"], success: true, data })}\n`);
        // Split every byte, including multibyte Korean characters and JSON delimiters.
        for (const byte of bytes) stdout.write(Buffer.from([byte]));
      }, child));
      callback();
    },
    final(callback) {
      callback();
      if (!ignoreEnd) queueMicrotask(() => exit(0, null));
    },
  });
  const kill = vi.fn((signal: string = "SIGTERM") => { queueMicrotask(() => exit(null, signal)); return true; });
  const child = Object.assign(emitter, { stdin, stdout, stderr, kill }) as unknown as ChildProcessWithoutNullStreams;
  const spawnImpl: SpawnImpl = vi.fn(() => child);
  const options: SessionTreeOptions = {
    binary: { path: "/fake/omo", version: "5.1.21", source: "override" },
    env: { PATH: "/native/bin", OMO_CODING_AGENT_DIR: "/agent" },
    cwd: "/workspace", sessionPath: "/sessions/one.jsonl", extensionPath: "/extensions/tree-selection-extension.js",
    operation: { type: "list" }, spawnImpl,
  };
  return { options, frames, spawnImpl, child, kill, exit, get exited() { return exited; } };
}

afterEach(() => vi.useRealTimers());

describe("session tree", () => {
  it("accepts runtime-only bindings after the captured leaf but keeps native guards for new messages", async () => {
    const snapshot = { leafId: "binding", tree: [node(entry("answer", null, "assistant", "old"), [node(custom("binding", "answer"))])] };
    const fake = fakeRunner((frame, reply) => {
      if (frame["type"] === "navigate_tree") reply({ outcome: "navigated", leafId: "binding" });
      else if (frame["type"] === "extension_request") reply({});
      else reply(snapshot);
    });
    await runSessionTree({ ...fake.options, operation: { type: "navigate", entryId: "answer", intent: "resume", expectedLeafId: "answer" } });
    expect(fake.frames.find(frame => frame["type"] === "navigate_tree")?.["expectedLeafId"]).toBe("binding");
  });
  it("lists original, edited-user, and custom-message branches through metadata tails and fragmented UTF-8", async () => {
    const fake = fakeRunner((_frame, reply, child) => {
      child.stdout.emit("data", Buffer.from(JSON.stringify({ type: "extension_ui_request", id: "notice", method: "notify", message: "No model available" }) + "\n"));
      reply(tree);
    });
    await expect(runSessionTree(fake.options)).resolves.toEqual({
      leafId: "persisted",
      branches: [
        { entryId: "original", label: "원래 응답", active: false },
        { entryId: "edited", label: "edited prompt", active: true },
        { entryId: "notice", label: "visible notice", active: false },
      ],
    });
    expect(fake.spawnImpl).toHaveBeenCalledWith("/fake/omo", ["--mode", "rpc", "--session", "/sessions/one.jsonl", "--no-extensions", "--extension", "/extensions/tree-selection-extension.js"], { cwd: "/workspace", env: fake.options.env, stdio: "pipe", windowsHide: true });
    expect(fake.frames.map((frame) => frame["type"])).toEqual(["get_tree"]);
    expect(fake.exited).toBe(true);
  });

  it.each(["select", "resume"] as const)("forwards %s semantics and persists only after successful native navigation", async (intent) => {
    let persisted = false;
    const fake = fakeRunner((frame, reply) => {
      if (frame["type"] === "navigate_tree") reply({ outcome: "navigated", leafId: "edited", editorText: "draft", summaryEntryId: "summary" });
      else if (frame["type"] === "extension_request") { persisted = true; reply(null); }
      else reply(persisted ? tree : { ...tree, leafId: "bookkeeping" });
    });
    fake.options.operation = { type: "navigate", entryId: "edited", intent, expectedLeafId: null };
    await expect(runSessionTree(fake.options)).resolves.toMatchObject({ outcome: "navigated", leafId: "persisted", editorText: "draft", summaryEntryId: "summary" });
    expect(fake.frames).toEqual([
      { id: "tree-1", type: "get_tree" },
      { id: "tree-2", type: "navigate_tree", entryId: "edited", ...(intent === "resume" ? { intent } : {}), expectedLeafId: null },
      { id: "tree-3", type: "extension_request", name: "omoui.tree.persist", data: {} },
      { id: "tree-4", type: "get_tree" },
    ]);
    expect(fake.exited).toBe(true);
  });

  it("preserves cancellation without appending a persistence entry", async () => {
    const fake = fakeRunner((frame, reply) => reply(frame["type"] === "navigate_tree" ? { outcome: "cancelled", leafId: "persisted", aborted: true } : tree));
    fake.options.operation = { type: "navigate", entryId: "edited", intent: "resume", expectedLeafId: "" };
    await expect(runSessionTree(fake.options)).resolves.toMatchObject({ outcome: "cancelled", aborted: true });
    expect(fake.frames[1]?.["expectedLeafId"]).toBe("");
    expect(fake.frames.map((frame) => frame["type"])).toEqual(["get_tree", "navigate_tree", "get_tree"]);
  });

  it("preserves typed native errors and closes the process before rejection", async () => {
    const fake = fakeRunner((frame, reply, child) => {
      if (frame["type"] === "get_tree") reply(tree);
      else child.stdout.emit("data", Buffer.from(`${JSON.stringify({ id: frame["id"], type: "response", command: "navigate_tree", success: false, error: "leaf moved", errorCode: "stale_leaf", errorData: { leafId: "new-leaf" } })}\n`));
    });
    fake.options.operation = { type: "navigate", entryId: "edited", intent: "resume" };
    await expect(runSessionTree(fake.options)).rejects.toMatchObject({ name: "SessionTreeRpcError", message: "leaf moved", command: "navigate_tree", errorCode: "stale_leaf", errorData: { leafId: "new-leaf" } });
    expect(fake.exited).toBe(true);
    expect(fake.frames).toHaveLength(2);
  });

  it.each([
    { tree: [], leafId: 5 },
    { tree: [node({ id: "bad", parentId: null, type: "message", message: null })], leafId: "bad" },
    { tree: [node(entry("a", null, "user"))], leafId: "missing" },
    { tree: [node(entry("a", null, "user")), node(entry("a", null, "user"))], leafId: "a" },
  ])("rejects malformed tree data and exits", async (data) => {
    const fake = fakeRunner((_frame, reply) => reply(data));
    await expect(runSessionTree(fake.options)).rejects.toMatchObject({ errorCode: "malformed_response" });
    expect(fake.exited).toBe(true);
  });

  it("fails closed on malformed JSON and interactive input", async () => {
    for (const line of ["broken JSON\n", '{"type":"extension_ui_request","id":"question"}\n']) {
      const fake = fakeRunner((_frame, _reply, child) => child.stdout.emit("data", Buffer.from(line)));
      await expect(runSessionTree(fake.options)).rejects.toBeInstanceOf(SessionTreeRpcError);
      expect(fake.exited).toBe(true);
    }
  });

  it("bounds startup and escalates cleanup for a child ignoring stdin end", async () => {
    vi.useFakeTimers();
    const fake = fakeRunner(() => undefined, true);
    fake.options.startTimeoutMs = 10;
    fake.options.stopTimeoutsMs = { afterStdinEnd: 10, afterSigterm: 10 };
    const rejection = expect(runSessionTree(fake.options)).rejects.toMatchObject({ command: "get_tree", errorCode: "timeout" });
    await vi.advanceTimersByTimeAsync(20);
    await rejection;
    expect(fake.kill).toHaveBeenCalledWith("SIGTERM");
    expect(fake.exited).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds navigation separately from startup", async () => {
    vi.useFakeTimers();
    const fake = fakeRunner((frame, reply) => { if (frame["type"] === "get_tree") reply(tree); });
    fake.options.operation = { type: "navigate", entryId: "edited", intent: "resume" };
    fake.options.startTimeoutMs = 100;
    fake.options.requestTimeoutMs = 10;
    const rejection = expect(runSessionTree(fake.options)).rejects.toMatchObject({ command: "navigate_tree", errorCode: "timeout" });
    await vi.advanceTimersByTimeAsync(10);
    await rejection;
    expect(fake.exited).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports process exit and spawn failure without leaving pending timers", async () => {
    const fake = fakeRunner((_frame, _reply, child) => {
      child.stderr.emit("data", "native failure");
      fake.exit(7, null);
    });
    await expect(runSessionTree(fake.options)).rejects.toMatchObject({ errorCode: "process_exit", errorData: { exitCode: 7, stderrTail: "native failure" } });
    const spawnFailure = fakeRunner((_frame, _reply, child) => { child.emit("error", new Error("ENOENT")); child.emit("close", null, null); });
    await expect(runSessionTree(spawnFailure.options)).rejects.toMatchObject({ errorCode: "process_exit" });
  });

  it("normalizes file-order selection without spawning or changing the file", () => {
    const source = [
      { type: "session", id: "session" }, entry("root", null, "user"),
      entry("old", "root", "assistant"), entry("alternate", "root", "user"),
      custom("oauth", "alternate"), custom("persisted", "old"),
    ].map((value) => JSON.stringify(value)).join("\n") + '\n{"type":';
    expect(parseSessionTree(source)).toEqual({ leafId: "persisted", branches: [
      { entryId: "old", label: "old", active: true }, { entryId: "alternate", label: "alternate", active: false },
    ] });
    expect(parseSessionTree("")).toEqual({ leafId: null, branches: [] });
  });

  it("reads the session file directly using UTF-8 without acquiring its process owner", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(entry("user", null, "user", "local branch")));
    await expect(readSessionTree("/sessions/local.jsonl")).resolves.toEqual({ leafId: "user", branches: [{ entryId: "user", label: "local branch", active: true }] });
    expect(readFile).toHaveBeenCalledWith("/sessions/local.jsonl", "utf8");
  });

  it("preserves an empty root selection and does not confuse its custom persistence leaf with a conversation", async () => {
    let selected = false;
    const fake = fakeRunner((frame, reply) => {
      if (frame["type"] === "navigate_tree") { selected = true; reply({ outcome: "navigated", leafId: null, editorText: "root prompt" }); }
      else if (frame["type"] === "extension_request") reply(null);
      else reply(selected ? { leafId: "empty-persist", tree: [...tree.tree, node({ type: "custom", id: "empty-persist", parentId: null })] } : tree);
    });
    fake.options.operation = { type: "navigate", entryId: "u1", intent: "select" };
    const result = await runSessionTree(fake.options);
    expect(result).toMatchObject({ leafId: "empty-persist", editorText: "root prompt", outcome: "navigated" });
    expect(result.branches.every((branch) => !branch.active)).toBe(true);
  });

  it("rejects failed persistence instead of reporting navigation as durable", async () => {
    const fake = fakeRunner((frame, reply, child) => {
      if (frame["type"] === "navigate_tree") reply({ outcome: "navigated", leafId: "edited" });
      else if (frame["type"] === "extension_request") child.stdout.emit("data", Buffer.from(`${JSON.stringify({ id: frame["id"], type: "response", command: "extension_request", success: false, error: "extension handler failed" })}\n`));
      else reply(tree);
    });
    fake.options.operation = { type: "navigate", entryId: "edited", intent: "resume" };
    await expect(runSessionTree(fake.options)).rejects.toMatchObject({ command: "extension_request", message: "extension handler failed" });
    expect(fake.exited).toBe(true);
  });

  it("escalates to SIGKILL and waits for exit when SIGTERM is ignored", async () => {
    vi.useFakeTimers();
    const fake = fakeRunner(() => undefined, true);
    fake.kill.mockImplementation((signal = "SIGTERM") => { if (signal === "SIGKILL") queueMicrotask(() => fake.exit(null, signal)); return true; });
    fake.options.startTimeoutMs = 10;
    fake.options.stopTimeoutsMs = { afterStdinEnd: 10, afterSigterm: 10 };
    const rejection = expect(runSessionTree(fake.options)).rejects.toMatchObject({ errorCode: "timeout" });
    await vi.advanceTimersByTimeAsync(30);
    await rejection;
    expect(fake.kill.mock.calls.map(([signal]) => signal)).toEqual(["SIGTERM", "SIGKILL"]);
    expect(fake.exited).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns a completed result after terminating a native RPC child that stays alive after EOF", async () => {
    vi.useFakeTimers();
    const fake = fakeRunner((_frame, reply) => reply(tree), true);
    fake.options.stopTimeoutsMs = { afterStdinEnd: 10, afterSigterm: 10 };
    const completion = runSessionTree(fake.options);
    await vi.advanceTimersByTimeAsync(10);
    await expect(completion).resolves.toMatchObject({ leafId: "persisted" });
    expect(fake.kill).toHaveBeenCalledWith("SIGTERM");
    expect(fake.exited).toBe(true);
  });

  it("registers only the benign persistence handler", () => {
    const handle = vi.fn();
    const appendEntry = vi.fn();
    treeSelectionExtension({ rpc: { handle }, appendEntry });
    expect(handle).toHaveBeenCalledWith("omoui.tree.persist", expect.any(Function));
    const callback = handle.mock.calls[0]?.[1] as (data: unknown) => void;
    callback({});
    expect(appendEntry).toHaveBeenCalledWith("omoui.tree.selection", {});
  });
});
