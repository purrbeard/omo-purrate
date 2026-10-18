import { describe, expect, it, vi } from "vitest";
import taskMessageExtension from "../../electron/omo/task-message-extension";

function extension(result: { isError?: boolean; content: { type: string; text: string }[]; details?: unknown } = { content: [] }) {
  const handlers = new Map<string, (data: unknown) => Promise<unknown>>();
  const executeTool = vi.fn(async () => result);
  taskMessageExtension({ rpc: { handle(name, callback) { handlers.set(name, callback); } }, executeTool, on: vi.fn(), appendEntry: vi.fn() });
  const handler = handlers.get("omo-ui.task.send");
  const cancel = handlers.get("omo-ui.task.cancel");
  if (handler === undefined || cancel === undefined) throw new Error("RPC handler missing");
  return { handler, cancel, executeTool };
}

function originExtension(sessionContext: Record<string, string> | undefined, entries: { type: string; customType?: string }[]) {
  const starts: ((event: unknown, ctx: { sessionManager: { getEntries(): typeof entries } }) => void | Promise<void>)[] = [];
  const appendEntry = vi.fn();
  taskMessageExtension({
    rpc: { handle() {} }, executeTool: vi.fn(), appendEntry, ...(sessionContext === undefined ? {} : { sessionContext }),
    on(_name, handler) { starts.push(handler); },
  });
  return { appendEntry, start: async () => { for (const handler of starts) await handler({ reason: "startup" }, { sessionManager: { getEntries: () => entries } }); } };
}

describe("creation marker", () => {
  it("records an app-opened session as bookkeeping before its first message", async () => {
    const { appendEntry, start } = originExtension({ created_by: "omo-ui", surface: "desktop" }, [{ type: "model_change" }]);
    await start();
    expect(appendEntry).toHaveBeenCalledWith("omo-ui.origin", { createdBy: "omo-ui", surface: "desktop" }, { startupBookkeeping: true });
  });
  it.each([[{ type: "message" }], [{ type: "custom", customType: "omo-ui.origin" }]])("does not mark a session that already holds %o", async entry => {
    const { appendEntry, start } = originExtension({ created_by: "omo-ui" }, [entry]);
    await start();
    expect(appendEntry).not.toHaveBeenCalled();
  });
  it.each<Record<string, string> | undefined>([undefined, {}, { created_by: "another-client" }])("leaves sessions other openers created unmarked (%o)", async context => {
    const { appendEntry, start } = originExtension(context, []);
    await start();
    expect(appendEntry).not.toHaveBeenCalled();
  });
});

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

describe("child agent RPC cancellation", () => {
  it("cancels the native task with inactive tool activation", async () => {
    const { cancel, executeTool } = extension();
    await expect(cancel({ taskId: "st_child" })).resolves.toEqual({ cancelled: true });
    expect(executeTool).toHaveBeenCalledWith("task_cancel", { task_id: "st_child" }, { activateInactiveTool: true });
  });
  it("passes the optional reason and returns native status", async () => {
    const { cancel, executeTool } = extension({ content: [], details: { status: "completed" } });
    await expect(cancel({ taskId: "st_child", reason: "No longer needed" })).resolves.toEqual({ cancelled: true, status: "completed" });
    expect(executeTool).toHaveBeenCalledWith("task_cancel", { task_id: "st_child", reason: "No longer needed" }, { activateInactiveTool: true });
  });
  it.each([null, "st_child", {}, { taskId: 123 }, { taskId: " " }, { taskId: "st_child", reason: 123 }])("rejects invalid cancellation input %j", async (data) => {
    const { cancel, executeTool } = extension();
    await expect(cancel(data)).rejects.toThrow("Invalid child task cancellation");
    expect(executeTool).not.toHaveBeenCalled();
  });
  it("propagates the native tool error text", async () => {
    const { cancel } = extension({ isError: true, content: [{ type: "text", text: "Task not owned" }, { type: "image", text: "ignored" }, { type: "text", text: "Cannot cancel" }] });
    await expect(cancel({ taskId: "st_foreign" })).rejects.toThrow("Task not owned\nCannot cancel");
  });
});
