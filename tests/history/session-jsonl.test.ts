import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../../electron/history/session-jsonl";

const HEADER = { type: "session", version: 3, id: "s1", timestamp: "2026-10-01T00:00:00.000Z", cwd: "/tmp" };

function ts(seconds: number): string {
  return new Date(Date.UTC(2026, 9, 1, 0, 0, seconds)).toISOString();
}

function message(id: string, parentId: string | null, seconds: number, body: Record<string, unknown>) {
  return { type: "message", id, parentId, timestamp: ts(seconds), message: body };
}

function user(id: string, parentId: string | null, seconds: number, text: string) {
  return message(id, parentId, seconds, { role: "user", content: [{ type: "text", text }] });
}

function assistant(id: string, parentId: string | null, seconds: number, content: unknown[], stopReason = "stop") {
  return message(id, parentId, seconds, { role: "assistant", content, stopReason });
}

function jsonl(entries: readonly unknown[]): string {
  return [HEADER, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

describe("parseSessionJsonl", () => {
  it("rebuilds both turns of the probe session fixture", () => {
    const text = readFileSync(resolve(__dirname, "../fixtures/probe-session.jsonl"), "utf8");

    const turns = parseSessionJsonl(text).turns;

    expect(turns).toHaveLength(2);
    const [first, second] = turns;
    expect(first?.status).toBe("completed");
    expect(first?.error).toBeNull();
    expect(first?.items.map((item) => item.type)).toEqual(["userMessage", "agentMessage"]);
    expect(first?.items[0]).toMatchObject({
      type: "userMessage",
      clientId: null,
      content: [{ type: "text", text: "Reply with exactly: pong", text_elements: [] }],
    });
    expect(first?.items[1]).toMatchObject({ type: "agentMessage", text: "pong", phase: null });

    expect(second?.status).toBe("completed");
    expect(second?.items.map((item) => item.type)).toEqual([
      "userMessage",
      "reasoning",
      "dynamicToolCall",
      "agentMessage",
    ]);
    const tool = second?.items[2];
    expect(tool).toMatchObject({ type: "dynamicToolCall", tool: "eval", status: "completed", success: true, durationMs: 35 });
    expect(JSON.stringify(tool)).toContain("omo-probe-42");
    expect(second?.items[3]).toMatchObject({ type: "agentMessage", text: "omo-probe-42" });
    expect(second?.startedAt).toBe(Date.parse("2026-10-01T04:10:42.458Z"));
    expect(second?.completedAt).toBe(Date.parse("2026-10-01T04:10:47.224Z"));
  });

  it("excludes an abandoned branch", () => {
    const text = jsonl([
      user("u1", null, 1, "hello"),
      assistant("a1", "u1", 2, [{ type: "text", text: "abandoned answer" }]),
      assistant("a2", "u1", 3, [{ type: "text", text: "kept answer" }]),
    ]);

    const turns = parseSessionJsonl(text).turns;

    expect(turns).toHaveLength(1);
    expect(turns[0]?.items.map((item) => item.id)).toEqual(["u1", "a2:0"]);
  });

  it("marks a turn interrupted when the last assistant message was aborted", () => {
    const text = jsonl([
      user("u1", null, 1, "go"),
      assistant("a1", "u1", 2, [{ type: "text", text: "partial" }], "aborted"),
    ]);

    const turns = parseSessionJsonl(text).turns;

    expect(turns[0]?.status).toBe("interrupted");
    expect(turns[0]?.completedAt).toBe(Date.parse(ts(2)));
  });

  it("marks a turn failed when the last assistant message errored", () => {
    const text = jsonl([user("u1", null, 1, "go"), assistant("a1", "u1", 2, [], "error")]);

    expect(parseSessionJsonl(text).turns[0]?.status).toBe("failed");
    expect(parseSessionJsonl(text).turns[0]?.error).toBeNull();
  });

  it("keeps the provider error from an empty assistant message", () => {
    const text = jsonl([
      user("u1", null, 1, "go"),
      message("a1", "u1", 2, {
        role: "assistant", content: [{ type: "text", text: "" }], stopReason: "error",
        errorMessage: "402: Insufficient Balance", provider: "deepseek",
      }),
    ]);
    expect(parseSessionJsonl(text).turns[0]).toMatchObject({
      status: "failed", error: { message: "402: Insufficient Balance" },
    });
  });

  it("keeps the last provider error in a turn", () => {
    const text = jsonl([
      user("u1", null, 1, "go"),
      message("a1", "u1", 2, { role: "assistant", content: [], stopReason: "error", errorMessage: "timeout" }),
      message("a2", "a1", 3, { role: "assistant", content: [], stopReason: "error", errorMessage: "402: Insufficient Balance" }),
    ]);
    expect(parseSessionJsonl(text).turns[0]?.error).toEqual({ message: "402: Insufficient Balance" });
  });

  it("drops a provider error once a later assistant message in the turn succeeds", () => {
    const text = jsonl([
      user("u1", null, 1, "go"),
      message("a1", "u1", 2, { role: "assistant", content: [], stopReason: "error", errorMessage: "timeout" }),
      assistant("a2", "a1", 3, [{ type: "text", text: "pong" }]),
    ]);
    expect(parseSessionJsonl(text).turns[0]).toMatchObject({ status: "completed", error: null });
  });

  it("marks a tool call failed when its result has isError", () => {
    const text = jsonl([
      user("u1", null, 1, "go"),
      assistant("a1", "u1", 2, [{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "false" } }], "toolUse"),
      message("r1", "a1", 3, {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "bash",
        isError: true,
        content: [
          { type: "text", text: "boom" },
          { type: "image", data: "QUJD", mimeType: "image/png" },
        ],
      }),
      assistant("a2", "r1", 4, [{ type: "text", text: "it failed" }]),
    ]);

    const turns = parseSessionJsonl(text).turns;

    expect(turns[0]?.items[1]).toMatchObject({
      type: "dynamicToolCall",
      id: "t1",
      tool: "bash",
      arguments: { command: "false" },
      status: "failed",
      success: false,
      durationMs: null,
      contentItems: [
        { type: "inputText", text: "boom" },
        { type: "inputImage", imageUrl: "data:image/png;base64,QUJD" },
      ],
    });
    expect(turns[0]?.status).toBe("completed");
  });

  it("skips malformed lines and unrendered entry types", () => {
    const lines = [
      JSON.stringify(HEADER),
      "{not json",
      JSON.stringify({ type: "model_change", id: "m1", parentId: null, timestamp: ts(0) }),
      JSON.stringify(user("u1", "m1", 1, "hi")),
      '{"type":"message","id":"broken"',
      JSON.stringify(assistant("a1", "u1", 2, [{ type: "text", text: "yo" }])),
    ];

    const turns = parseSessionJsonl(lines.join("\n")).turns;

    expect(turns).toHaveLength(1);
    expect(turns[0]?.items.map((item) => item.type)).toEqual(["userMessage", "agentMessage"]);
  });

  it("keeps a final turn with an unanswered tool call in progress", () => {
    const text = jsonl([
      user("u1", null, 1, "go"),
      assistant("a1", "u1", 2, [{ type: "text", text: "done" }]),
      user("u2", "a1", 3, "run it"),
      assistant("a2", "u2", 4, [{ type: "toolCall", id: "t1", name: "eval", arguments: {} }], "toolUse"),
    ]);

    const turns = parseSessionJsonl(text).turns;

    expect(turns.map((turn) => turn.status)).toEqual(["completed", "inProgress"]);
    expect(turns[1]?.completedAt).toBeNull();
    expect(turns[1]?.items[1]).toMatchObject({ type: "dynamicToolCall", status: "inProgress", success: null });
  });

  it("adds compaction entries to the current turn and renders user images", () => {
    const text = jsonl([
      message("u1", null, 1, {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image", data: "QUJD", mimeType: "image/jpeg" },
        ],
      }),
      assistant("a1", "u1", 2, [{ type: "thinking", thinking: "" }, { type: "text", text: "ok" }]),
      { type: "compaction", id: "c1", parentId: "a1", timestamp: ts(3), summary: "s", firstKeptEntryId: "u1" },
    ]);

    const turns = parseSessionJsonl(text).turns;

    expect(turns[0]?.items).toEqual([
      {
        type: "userMessage",
        id: "u1",
        clientId: null,
        content: [
          { type: "text", text: "look", text_elements: [] },
          { type: "image", url: "data:image/jpeg;base64,QUJD" },
        ],
      },
      { type: "agentMessage", id: "a1:1", text: "ok", phase: null },
      { type: "contextCompaction", id: "c1" },
    ]);
  });

  it("parses a generated 20,000-line session in under one second", () => {
    const entries: unknown[] = [];
    let parentId: string | null = null;
    for (let i = 0; i < 10_000; i += 1) {
      const userId = `u${i}`;
      const assistantId = `a${i}`;
      entries.push(user(userId, parentId, 2 * i, `question ${i}`));
      entries.push(assistant(assistantId, userId, 2 * i + 1, [{ type: "text", text: `answer ${i}` }]));
      parentId = assistantId;
    }
    const text = jsonl(entries);

    const started = performance.now();
    const turns = parseSessionJsonl(text).turns;
    const elapsed = performance.now() - started;

    expect(text.split("\n").filter((line) => line !== "")).toHaveLength(20_001);
    expect(turns).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(1000);
  });
});
