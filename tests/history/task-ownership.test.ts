import { expect, it } from "vitest";
import { parseSessionJsonl } from "../../electron/history/session-jsonl";

it("keeps spawn-turn ownership when a task completes during a later request", () => {
  const entries = [
    { type: "session", version: 3, id: "session", cwd: "/tmp" },
    { type: "message", id: "first", parentId: null, message: { role: "user", content: [{ type: "text", text: "First" }] } },
    { type: "message", id: "spawn-a", parentId: "first", message: { role: "toolResult", toolName: "task", toolCallId: "call-a", content: [],
      details: { task_id: "task-a", status: "running", mode: "spawn", execution_mode: "in-process" } } },
    { type: "message", id: "second", parentId: "spawn-a", message: { role: "user", content: [{ type: "text", text: "Second" }] } },
    { type: "message", id: "spawn-b", parentId: "second", message: { role: "toolResult", toolName: "task", toolCallId: "call-b", content: [],
      details: { task_id: "task-b", status: "running", mode: "spawn", execution_mode: "in-process" } } },
    { type: "custom_message", id: "done", parentId: "spawn-b", customType: "omo-senpi:wake",
      details: [{ customType: "senpi-task.completion", details: [{ task_id: "task-a", status: "completed" }] }] },
  ];
  const result = parseSessionJsonl(entries.map(entry => JSON.stringify(entry)).join("\n"));
  expect(result.tasks).toMatchObject([
    { task_id: "task-a", turn_id: "first", status: "completed" },
    { task_id: "task-b", turn_id: "second", status: "running" },
  ]);
});
