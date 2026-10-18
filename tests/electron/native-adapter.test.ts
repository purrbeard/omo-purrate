import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RpcNotification, Turn } from "../../shared/protocol";
import { classifyTool, TurnProjector } from "../../electron/omo/native/projector";
import { SessionIndex } from "../../electron/omo/native/threads";

function projector(): { turn: TurnProjector; sent: RpcNotification[]; completed: () => Turn } {
  const sent: RpcNotification[] = [];
  let clock = 1_000_000;
  const turn = new TurnProjector("thread-1", "/work", (notification) => sent.push(notification), () => (clock += 10));
  const completed = (): Turn => {
    const last = sent.filter((entry) => entry.method === "turn/completed").at(-1);
    if (last === undefined) throw new Error("no turn/completed");
    return (last.params as { turn: Turn }).turn;
  };
  return { turn, sent, completed };
}

const assistant = (content: unknown[], stopReason = "stop", extra: Record<string, unknown> = {}) =>
  ({ role: "assistant", content, stopReason, ...extra });

describe("TurnProjector", () => {
  it("projects a streamed answer and a bash call onto one completed turn", () => {
    const { turn, sent, completed } = projector();
    turn.beginClientTurn([{ type: "text", text: "hi", text_elements: [] }], "client-1");
    turn.handle({ type: "agent_start" });
    turn.handle({ type: "message_start", message: { role: "user", content: "hi" } });
    turn.handle({ type: "message_start", message: { role: "assistant", content: [] } });
    turn.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "po" } });
    turn.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "ng" } });
    turn.handle({ type: "message_end", message: assistant([{ type: "text", text: "pong" }]) });
    turn.handle({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "echo ok" } });
    turn.handle({ type: "tool_execution_update", toolCallId: "t1", partialResult: { content: [{ type: "text", text: "o" }] } });
    turn.handle({ type: "tool_execution_end", toolCallId: "t1", result: { content: [{ type: "text", text: "ok\n" }], details: { exitCode: 0 } } });
    turn.handle({ type: "agent_settled" });

    expect(sent.filter((entry) => entry.method === "item/agentMessage/delta").map((entry) => (entry.params as { delta: string }).delta)).toEqual(["po", "ng"]);
    expect(sent.filter((entry) => entry.method === "turn/started")).toHaveLength(1);
    const done = completed();
    expect(done.status).toBe("completed");
    expect(done.items.map((item) => item.type)).toEqual(["userMessage", "agentMessage", "commandExecution"]);
    expect(done.items[0]).toMatchObject({ id: "client-1", clientId: "client-1" });
    expect(done.items[1]).toMatchObject({ text: "pong" });
    expect(done.items[2]).toMatchObject({ command: "echo ok", cwd: "/work", status: "completed", exitCode: 0, aggregatedOutput: "ok\n" });
    expect(turn.activeTurnId).toBeNull();
  });

  it("reports an interrupt both from the client's abort and from an aborted stop reason", () => {
    const first = projector();
    first.turn.beginClientTurn([], null);
    first.turn.handle({ type: "message_start", message: { role: "assistant", content: [] } });
    first.turn.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "1 2 3" } });
    first.turn.markInterrupted();
    first.turn.handle({ type: "agent_settled" });
    expect(first.completed()).toMatchObject({ status: "interrupted" });
    expect(first.completed().items.at(-1)).toMatchObject({ type: "agentMessage", text: "1 2 3" });

    const second = projector();
    second.turn.handle({ type: "agent_start" });
    second.turn.handle({ type: "message_end", message: assistant([], "aborted") });
    second.turn.handle({ type: "agent_end" });
    expect(second.completed().status).toBe("interrupted");
  });

  it("fails the turn with omo's error message and closes open tools when the session goes away", () => {
    const failed = projector();
    failed.turn.handle({ type: "agent_start" });
    failed.turn.handle({ type: "message_end", message: assistant([], "error", { errorMessage: "rate limited" }) });
    failed.turn.handle({ type: "agent_settled" });
    expect(failed.sent.find((entry) => entry.method === "error")?.params).toMatchObject({ error: { message: "rate limited" }, willRetry: false });
    expect(failed.completed()).toMatchObject({ status: "failed", error: { message: "rate limited" } });

    const abandoned = projector();
    abandoned.turn.handle({ type: "tool_execution_start", toolCallId: "t2", toolName: "read", args: { path: "a" } });
    abandoned.turn.abandon();
    expect(abandoned.completed()).toMatchObject({ status: "interrupted" });
    expect(abandoned.completed().items).toEqual([expect.objectContaining({ type: "dynamicToolCall", id: "t2", tool: "read", status: "completed" })]);
  });

  it("classifies omo's tools the way the removed app-server did", () => {
    expect(["bash", "edit", "write", "apply_patch", "github__search", "read"].map(classifyTool))
      .toEqual(["commandExecution", "fileChange", "fileChange", "fileChange", "mcpToolCall", "dynamicToolCall"]);
  });
});

describe("SessionIndex", () => {
  let root = "";
  afterEach(async () => { if (root !== "") await rm(root, { recursive: true, force: true }); });

  const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

  it("lists sessions from their files and picks up appended and partial lines on the next scan", async () => {
    root = await mkdtemp(path.join(tmpdir(), "native-index-"));
    const folder = path.join(root, "--work--");
    await mkdir(folder, { recursive: true });
    const file = path.join(folder, "2026-10-18T00-00-00-000Z_s1.jsonl");
    await writeFile(file, line({ type: "session", id: "s1", timestamp: "2026-10-18T00:00:00.000Z", cwd: "/work" }));
    await writeFile(path.join(folder, "notes.txt"), "not a session");
    const index = new SessionIndex(root);

    expect(await index.list()).toEqual([expect.objectContaining({ id: "s1", cwd: "/work", name: null, preview: null, createdAtMs: Date.parse("2026-10-18T00:00:00.000Z") })]);

    const user = line({ type: "message", message: { role: "user", content: [{ type: "text", text: "first ask" }] } });
    await appendFile(file, user + line({ type: "session_info", name: "Renamed" }).slice(0, 10));
    expect((await index.find("s1"))).toMatchObject({ preview: "first ask", name: null });
    await appendFile(file, line({ type: "session_info", name: "Renamed" }).slice(10));
    expect((await index.find("s1"))).toMatchObject({ preview: "first ask", name: "Renamed" });
  });

  it("forks into a new file whose header names the source, and archives through a sidecar", async () => {
    root = await mkdtemp(path.join(tmpdir(), "native-index-"));
    const folder = path.join(root, "--work--");
    await mkdir(folder, { recursive: true });
    const file = path.join(folder, "s1.jsonl");
    const body = line({ type: "message", message: { role: "user", content: "hello" } });
    await writeFile(file, line({ type: "session", id: "s1", timestamp: "2026-10-18T00:00:00.000Z", cwd: "/work" }) + body);
    const index = new SessionIndex(root);
    const [source] = await index.list();

    const forked = await index.fork(source!, "/other", Date.parse("2026-10-18T01:00:00.000Z"));
    const [header, ...rest] = (await readFile(forked, "utf8")).split("\n");
    expect(JSON.parse(header!)).toMatchObject({ type: "session", cwd: "/other", parentSession: file, timestamp: "2026-10-18T01:00:00.000Z" });
    expect(`${rest.join("\n")}`).toBe(body);
    expect((await index.list()).map((record) => record.id)).toHaveLength(2);

    expect(await index.isArchived(source!)).toBe(false);
    await index.archive(source!);
    expect(await index.isArchived(source!)).toBe(true);
    await index.unarchive(source!);
    expect(await index.isArchived(source!)).toBe(false);
  });
});
