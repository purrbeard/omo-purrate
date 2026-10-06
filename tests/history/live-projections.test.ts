import { describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../../electron/history/session-jsonl";

const todo = (status = "abandoned") => ({ schema: "v2", phases: [
  { name: "Build", tasks: [{ content: "build", status: "completed" }] },
  { name: "Check", tasks: [{ content: "check", status }] },
] });
const entry = (id: string, parentId: string | null, data: unknown) => ({
  type: "custom", customType: "senpi.todo-state", id, parentId, data,
});
const receipt = { task_id: "t", status: "running", mode: "spawn", task_summary: "do work", name: "lane",
  subagent_type: "explore", execution_mode: "in-process", resolved_model: { display: "model" } };
function result(id: string, parentId: string | null, details: unknown) {
  return { type: "message", id, parentId, message: { role: "toolResult", toolName: "task", details } };
}
function completion(id: string, parentId: string | null, records: unknown[]) {
  return { type: "custom_message", customType: "omo-senpi:wake", id, parentId,
    details: [{ customType: "senpi-task.completion", details: records }] };
}
const jsonl = (...entries: unknown[]) => entries.map((value) => JSON.stringify(value)).join("\n");

describe("history projections", () => {
  it("returns turns todo and tasks even for an empty session", () => {
    expect(parseSessionJsonl("")).toEqual({ turns: [], todo: null, tasks: [] });
  });
  it("restores latest valid todo on the active branch with malformed trailing data", () => {
    const text = jsonl(entry("root", null, todo("pending")), entry("abandoned-branch", "root", todo("in_progress")),
      entry("active", "root", todo()), entry("malformed", "active", { schema: "v2", phases: [{ tasks: [] }] })) + '\n{"type":';
    expect(parseSessionJsonl(text).todo).toEqual({ phases: todo().phases });
    expect(parseSessionJsonl(text).todo?.phases[1]?.tasks[0]?.status).toBe("abandoned");
  });
  it("maps legacy cancelled status and accepts an empty replacement", () => {
    const text = jsonl(entry("a", null, todo("cancelled")));
    expect(parseSessionJsonl(text).todo?.phases[1]?.tasks[0]?.status).toBe("abandoned");
    expect(parseSessionJsonl(text + "\n" + jsonl(entry("b", "a", { schema: "v2", phases: [] }))).todo).toEqual({ phases: [] });
  });
  it("projects a receipt without implying a live roster", () => {
    expect(parseSessionJsonl(jsonl(result("a", null, receipt))).tasks).toEqual([{
      task_id: "t", status: "running", mode: "spawn", task_summary: "do work", name: "lane",
      agent_type: "explore", execution_mode: "in-process", model: "model", source: "history",
    }]);
  });
  it("merges latest completion into a receipt preserving identity and model", () => {
    const text = jsonl(result("a", null, receipt), completion("b", "a", [{ task_id: "t", status: "completed", final_response: "done", final_response_truncated: true }]));
    expect(parseSessionJsonl(text).tasks).toEqual([{
      task_id: "t", status: "completed", mode: "spawn", task_summary: "do work", name: "lane",
      agent_type: "explore", execution_mode: "in-process", model: "model", source: "history",
      final_response: "done", final_response_truncated: true,
    }]);
  });
  it("projects completion-only records and ignores malformed entries", () => {
    const text = jsonl(result("a", null, { task_id: "bad", status: "running" }), completion("b", "a", [
      { task_id: "t", status: "error", name: "lane", agent_type: "explore", model: "model", error_message: "failed" },
      { task_id: "bad", status: 3 }, { task_id: "bad", status: "completed", model: {} },
    ]));
    expect(parseSessionJsonl(text).tasks).toEqual([{
      task_id: "t", status: "error", name: "lane", agent_type: "explore", model: "model", error_message: "failed", source: "history",
    }]);
  });
  it("excludes task completions on an inactive branch", () => {
    const text = jsonl(result("a", null, receipt), completion("abandoned", "a", [{ task_id: "t", status: "completed", final_response: "wrong" }]),
      completion("active", "a", [{ task_id: "t", status: "error", error_message: "kept" }]));
    expect(parseSessionJsonl(text).tasks[0]).toMatchObject({ status: "error", error_message: "kept" });
    expect(parseSessionJsonl(text).tasks[0]?.final_response).toBeUndefined();
  });
  it("uses the latest completion rather than retaining older optional output", () => {
    const text = jsonl(result("a", null, receipt), completion("b", "a", [{ task_id: "t", status: "completed", final_response: "old" }]),
      completion("c", "b", [{ task_id: "t", status: "error", error_message: "latest" }]));
    const task = parseSessionJsonl(text).tasks[0];
    expect(task).toMatchObject({ status: "error", name: "lane", error_message: "latest" });
    expect(task?.final_response).toBeUndefined();
  });
});
