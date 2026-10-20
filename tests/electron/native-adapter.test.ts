import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { RpcNotification, Turn } from "../../shared/protocol";
import { classifyTool, TurnProjector } from "../../electron/omo/native/projector";
import { SessionIndex } from "../../electron/omo/native/threads";
import { UiBridge } from "../../electron/omo/native/ui-bridge";
import type { RpcServerRequest } from "../../shared/protocol";

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

  it("carries a compaction's reason, progress and outcome onto its item", () => {
    const done = projector();
    done.turn.handle({ type: "compaction_start", reason: "threshold" });
    const started = done.sent.find((entry) => entry.method === "item/started");
    expect(started?.params).toMatchObject({ item: { type: "contextCompaction", reason: "threshold", status: "inProgress" } });
    done.turn.handle({
      type: "compaction_end",
      reason: "threshold",
      result: { summary: "kept the plan", firstKeptEntryId: "e1", tokensBefore: 150000, estimatedTokensAfter: 32000 },
      aborted: false,
      willRetry: false,
    });
    expect(done.completed().items).toEqual([{
      type: "contextCompaction",
      id: (started?.params as { item: { id: string } }).item.id,
      reason: "threshold",
      status: "completed",
      tokensBefore: 150000,
      estimatedTokensAfter: 32000,
      summary: "kept the plan",
      error: null,
      willRetry: false,
    }]);

    const failed = projector();
    failed.turn.handle({ type: "compaction_start", reason: "overflow" });
    failed.turn.handle({ type: "compaction_end", reason: "overflow", result: null, aborted: false, willRetry: false, errorMessage: "quota exceeded" });
    expect(failed.completed()).toMatchObject({
      status: "failed",
      items: [{ type: "contextCompaction", reason: "overflow", status: "failed", tokensBefore: null, summary: null, error: "quota exceeded" }],
    });

    const cancelled = projector();
    cancelled.turn.handle({ type: "compaction_start", reason: "manual" });
    cancelled.turn.handle({ type: "compaction_end", reason: "manual", result: null, aborted: true, willRetry: false });
    expect(cancelled.completed()).toMatchObject({ status: "interrupted", items: [{ status: "aborted", error: null }] });
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
    expect(["bash", "edit", "write", "apply_patch", "multiedit", "github__search", "read"].map(classifyTool))
      .toEqual(["commandExecution", "fileChange", "fileChange", "fileChange", "fileChange", "mcpToolCall", "dynamicToolCall"]);
  });

  it("keeps a turn open through an auto-retry and continues the same turn when it succeeds", () => {
    const { turn, sent, completed } = projector();
    turn.beginClientTurn([{ type: "text", text: "hi", text_elements: [] }], "c1");
    turn.handle({ type: "message_end", message: assistant([], "error", { errorMessage: "529 overloaded" }) });
    turn.handle({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "529 overloaded" });
    turn.handle({ type: "agent_end", willRetry: true });
    expect(turn.retryPending).toBe(true);
    expect(sent.some((entry) => entry.method === "turn/completed")).toBe(false);
    expect(sent.filter((entry) => entry.method === "error")).toEqual([
      expect.objectContaining({ params: expect.objectContaining({ willRetry: true, error: expect.objectContaining({ message: expect.stringContaining("attempt 1/3") }) }) }),
    ]);
    const turnId = turn.activeTurnId;
    turn.handle({ type: "auto_retry_end", success: true, attempt: 1 });
    expect(turn.retryPending).toBe(false);
    turn.handle({ type: "message_end", message: assistant([{ type: "text", text: "ok" }]) });
    turn.handle({ type: "agent_end" });
    expect(sent.filter((entry) => entry.method === "turn/started")).toHaveLength(1);
    expect(completed()).toMatchObject({ id: turnId, status: "completed", error: null });
    expect(sent.filter((entry) => entry.method === "error")).toHaveLength(1);
  });

  it("fails the turn with the final error when the retries run out, and agent_end alone does not end a pending retry", () => {
    const { turn, sent, completed } = projector();
    turn.beginClientTurn([], null);
    turn.handle({ type: "message_end", message: assistant([], "error", { errorMessage: "529 overloaded" }) });
    turn.handle({ type: "auto_retry_start", attempt: 1, maxAttempts: 2, delayMs: 10, errorMessage: "529 overloaded" });
    turn.handle({ type: "agent_end" });
    expect(sent.some((entry) => entry.method === "turn/completed")).toBe(false);
    turn.handle({ type: "auto_retry_end", success: false, attempt: 2, finalError: "529 overloaded_error: Overloaded" });
    turn.handle({ type: "agent_settled" });
    expect(completed()).toMatchObject({ status: "failed", error: { message: "529 overloaded_error: Overloaded" } });
    expect(sent.filter((entry) => entry.method === "error").at(-1)?.params).toMatchObject({ willRetry: false });
  });

  it("previews the files a running file tool changes from its arguments", () => {
    const { turn, sent } = projector();
    turn.handle({ type: "tool_execution_start", toolCallId: "e1", toolName: "edit", args: { path: "src/a.ts", oldText: "one", newText: "two" } });
    turn.handle({ type: "tool_execution_start", toolCallId: "m1", toolName: "multiedit", args: { path: "src/b.ts", edits: [{ oldText: "x", newText: "y" }, { oldText: "p", newText: "q" }] } });
    turn.handle({ type: "tool_execution_start", toolCallId: "w1", toolName: "write", args: { path: "src/c.ts", content: "hello\n" } });
    turn.handle({ type: "tool_execution_start", toolCallId: "p1", toolName: "apply_patch", args: { input: "*** Begin Patch\n*** Update File: src/d.ts\n@@\n-a\n+b\n*** Add File: src/e.ts\n+new\n*** End Patch" } });
    const started = sent.filter((entry) => entry.method === "item/started").map((entry) => (entry.params as { item: { id: string; type: string; changes: Array<{ path: string; diff: string }> } }).item);
    expect(started.map((item) => item.type)).toEqual(["fileChange", "fileChange", "fileChange", "fileChange"]);
    expect(started[0]?.changes).toEqual([expect.objectContaining({ path: "src/a.ts", diff: "-one\n+two\n" })]);
    expect(started[1]?.changes).toEqual([expect.objectContaining({ path: "src/b.ts", diff: "-x\n+y\n-p\n+q\n" })]);
    expect(started[2]?.changes).toEqual([expect.objectContaining({ path: "src/c.ts", diff: "+hello\n" })]);
    expect(started[3]?.changes.map((change) => change.path)).toEqual(["src/d.ts", "src/e.ts"]);
    expect(turn.filePathsOf("p1")).toEqual(["src/d.ts", "src/e.ts"]);
    expect(turn.filePathsOf("missing")).toEqual([]);
  });

  it("carries tool-result images into the tool item: kept files as file URLs, inline data as data URLs", () => {
    const { turn, completed } = projector();
    turn.handle({ type: "tool_execution_start", toolCallId: "r1", toolName: "read", args: { path: "shot.png" } });
    turn.handle({
      type: "tool_execution_end", toolCallId: "r1",
      result: { content: [
        { type: "text", text: "image" },
        { type: "image_ref", mimeType: "image/png", byteLength: 10, ref: { toolCallId: "r1", contentIndex: 1 }, path: path.resolve("/media/a b.png") },
        { type: "image_ref", mimeType: "image/png", byteLength: 10, ref: { toolCallId: "r1", contentIndex: 2 }, unavailableReason: "image_too_large" },
        { type: "image", mimeType: "image/jpeg", data: "QUJD" },
      ] },
    });
    turn.handle({ type: "agent_settled" });
    const item = completed().items[0];
    expect(item).toMatchObject({ type: "dynamicToolCall", tool: "read" });
    expect((item as { contentItems: unknown }).contentItems).toEqual([
      { type: "inputText", text: "image" },
      { type: "inputImage", imageUrl: pathToFileURL(path.resolve("/media/a b.png")).href },
      { type: "inputImage", imageUrl: "data:image/jpeg;base64,QUJD" },
    ]);
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

  it("lists an OmO (Alpha) store beside omo's sessions, once per id, and never writes into or deletes from it", async () => {
    root = await mkdtemp(path.join(tmpdir(), "native-index-"));
    const sessions = path.join(root, "agent", "sessions");
    const alpha = path.join(root, "desktop", "userdata", "omo-sessions");
    const runtime = path.join(alpha, "omo-0123");
    await mkdir(path.join(sessions, "--work--"), { recursive: true });
    await mkdir(runtime, { recursive: true });
    await writeFile(path.join(sessions, "--work--", "own.jsonl"), line({ type: "session", id: "own", timestamp: "2026-10-18T00:00:00.000Z", cwd: "/work" }));
    const header = { type: "session", version: 3, id: "a1", timestamp: "2026-10-20T13:02:04.097Z", cwd: "/lift" };
    const opening = path.join(runtime, "thread-a1-hash-1792501324079-1.jsonl");
    const continued = path.join(runtime, "thread-a1-hash-1792501348101-2.jsonl");
    await writeFile(opening, line(header) + line({ type: "model_change", id: "m1", parentId: null, provider: "p", modelId: "m" }));
    const conversation = line(header) + line({ type: "message", id: "u1", parentId: null, message: { role: "user", content: [{ type: "text", text: "make an intro" }] } });
    await writeFile(continued, conversation);
    const index = new SessionIndex(sessions, () => [alpha]);

    const records = await index.list();
    expect(records.map((record) => [record.id, record.source ?? "native"]).sort()).toEqual([["a1", "alpha"], ["own", "native"]]);
    const found = await index.find("a1");
    expect(found).toMatchObject({ sessionPath: continued, preview: "make an intro", source: "alpha" });
    expect(index.isExternal(found!)).toBe(true);

    await expect(index.remove(found!)).rejects.toThrow(/archive/);
    expect(await readFile(continued, "utf8")).toBe(conversation);

    const forked = await index.fork(found!, "/lift", Date.parse("2026-10-20T14:00:00.000Z"));
    expect(path.dirname(forked)).toBe(path.join(sessions, "---lift--"));
    expect(JSON.parse((await readFile(forked, "utf8")).split("\n")[0]!)).toMatchObject({ cwd: "/lift", parentSession: continued });
  });
});

describe("UiBridge extension dialogs", () => {
  const session = { threadId: "thread-1", handle: "h1", cwd: "/work", activeTurnId: "turn-1" };
  function make() {
    const answers: Record<string, unknown>[] = [];
    const requests: RpcServerRequest[] = [];
    const notifications: RpcNotification[] = [];
    const bridge = new UiBridge((_handle, frame) => answers.push(frame), (request) => requests.push(request), (notification) => notifications.push(notification));
    return { bridge, answers, requests, notifications };
  }

  it("asks a non-permission select as a question and answers with the chosen option", () => {
    const { bridge, answers, requests } = make();
    bridge.handle(session, { id: "u1", method: "select", title: "Pick one", options: ["A", "B"], timeout: 5000 });
    expect(answers).toEqual([]);
    const request = requests[0]!;
    expect(request.method).toBe("item/tool/requestUserInput");
    const params = request.params as { questions: { id: string; question: string; options: { label: string }[] }[]; timeoutMs: number };
    expect(params.timeoutMs).toBe(5000);
    expect(params.questions[0]!.question).toBe("Pick one");
    expect(params.questions[0]!.options.map((option) => option.label)).toEqual(["A", "B"]);
    bridge.respond(request.id, { answers: { value: { answers: ["B"] } } });
    expect(answers).toEqual([{ id: "u1", value: "B" }]);
  });

  it("maps a dismissed select to cancelled", () => {
    const { bridge, answers, requests } = make();
    bridge.handle(session, { id: "u2", method: "select", title: "Pick", options: ["A"] });
    bridge.respond(requests[0]!.id, { cancelled: true });
    expect(answers).toEqual([{ id: "u2", cancelled: true }]);
  });

  it("asks input and editor as free-text questions, showing the editor prefill", () => {
    const { bridge, answers, requests } = make();
    bridge.handle(session, { id: "u3", method: "input", title: "Name?" });
    bridge.handle(session, { id: "u4", method: "editor", title: "Edit", prefill: "line 1" });
    const [input, editor] = requests.map((request) => (request.params as { questions: { question: string; options: unknown }[] }).questions[0]!);
    expect(input).toMatchObject({ question: "Name?", options: null });
    expect(editor!.question).toBe("Edit\n\nline 1");
    bridge.respond(requests[0]!.id, { answers: { value: { answers: ["Ada"] } } });
    bridge.respond(requests[1]!.id, { answers: { value: { answers: ["edited"] } } });
    expect(answers).toEqual([{ id: "u3", value: "Ada" }, { id: "u4", value: "edited" }]);
  });

  it("still turns permission prompts into approvals", () => {
    const { bridge, answers, requests } = make();
    bridge.handle(session, { id: "u5", method: "select", title: "Permission required: bash\n\nCommand: $ ls", options: ["Allow once", "Deny"] });
    expect(requests[0]!.method).toBe("item/commandExecution/requestApproval");
    bridge.respond(requests[0]!.id, { decision: "accept" });
    expect(answers).toEqual([{ id: "u5", value: "Allow once" }]);
  });

  it("emits notify and keeps a per-thread status map where empty text clears a key", () => {
    const { bridge, notifications } = make();
    bridge.handle(session, { id: "n1", method: "notify", message: "Heads up", notifyType: "warning" });
    bridge.handle(session, { method: "setStatus", statusKey: "a", statusText: "one" });
    bridge.handle(session, { method: "setStatus", statusKey: "b", statusText: "two" });
    bridge.handle(session, { method: "setStatus", statusKey: "a" });
    bridge.handle(session, { method: "set_editor_text", text: "draft" });
    bridge.handle(session, { method: "setTitle", title: "ignored" });
    expect(notifications.map((entry) => (entry.params as { name: string; data: unknown }))).toEqual([
      expect.objectContaining({ name: "omo-ui:notify", data: { id: "n1", message: "Heads up", notifyType: "warning" } }),
      expect.objectContaining({ name: "omo-ui:status", data: { entries: { a: "one" } } }),
      expect.objectContaining({ name: "omo-ui:status", data: { entries: { a: "one", b: "two" } } }),
      expect.objectContaining({ name: "omo-ui:status", data: { entries: { b: "two" } } }),
      expect.objectContaining({ name: "omo-ui:editor-text", data: { text: "draft" } }),
    ]);
  });
});
