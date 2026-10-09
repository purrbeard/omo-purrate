import { describe, expect, it, vi } from "vitest";
import taskMessageExtension from "../../electron/omo/task-message-extension";

function extension(result: { isError?: boolean; content: { type: string; text: string }[]; details?: unknown } = { content: [] }) {
  let handler: ((data: unknown) => Promise<unknown>) | undefined;
  const executeTool = vi.fn(async () => result);
  taskMessageExtension({ rpc: { handle(name, callback) { expect(name).toBe("omo-ui.task.send"); handler = callback; } }, executeTool });
  if (handler === undefined) throw new Error("RPC handler missing");
  return { handler, executeTool };
}

describe("child agent RPC messages", () => {
  it("uses native task ownership rather than replaying a conversation", async () => {
    const { handler, executeTool } = extension();
    await expect(handler({ taskId: "st_child", message: "Continue this task" })).resolves.toEqual({ delivered: true });
    expect(executeTool).toHaveBeenCalledWith("task_send", { to: "st_child", message: "Continue this task" }, { activateInactiveTool: true });
  });
  it("preserves native delivery errors", async () => {
    const { handler } = extension({ isError: true, content: [{ type: "text", text: "not owned by this session" }] });
    await expect(handler({ taskId: "st_foreign", message: "Continue" })).rejects.toThrow("not owned by this session");
  });
  it("rejects empty inputs before invoking the native tool", async () => {
    const { handler, executeTool } = extension();
    await expect(handler({ taskId: "st_child", message: " " })).rejects.toThrow("Invalid child task message");
    expect(executeTool).not.toHaveBeenCalled();
  });
  it("keeps drafts when native reports a typed refusal without isError", async () => {
    const { handler } = extension({ content: [{ type: "text", text: "No task found" }], details: { kind: "not_found" } });
    await expect(handler({ taskId: "st_missing", message: "Continue" })).rejects.toThrow("No task found");
  });
  it.each(["steered", "revived", "queued", "capacity_deferred"])("treats the native %s outcome as delivered", async (kind) => {
    const { handler } = extension({ content: [{ type: "text", text: "Revived st_child (run epoch 1)." }], details: { kind } });
    await expect(handler({ taskId: "st_child", message: "Continue" })).resolves.toEqual({ delivered: true });
  });
  it("passes cross-owner scope only for linked descendant input", async () => {
    const { handler, executeTool } = extension();
    await handler({ taskId: "st_nested", message: "Continue", allScope: true });
    expect(executeTool).toHaveBeenCalledWith("task_send", { to: "st_nested", message: "Continue", all_scope: true }, { activateInactiveTool: true });
  });
});
