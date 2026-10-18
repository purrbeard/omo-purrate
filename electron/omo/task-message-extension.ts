import { ORIGIN_CONTEXT, ORIGIN_ENTRY } from "../../shared/session-origin";

type ToolResult = { readonly isError?: boolean; readonly content: readonly { readonly type: string; readonly text?: string }[]; readonly details?: unknown };
type SessionEntry = { readonly type: string; readonly customType?: string };
type Api = {
  readonly rpc: { handle(name: string, handler: (data: unknown) => Promise<unknown>): void };
  readonly sessionContext?: Readonly<Record<string, string>>;
  executeTool(name: string, args: object, options: { activateInactiveTool: boolean }): Promise<ToolResult>;
  on(event: "session_start", handler: (event: unknown, ctx: { readonly sessionManager: { getEntries(): readonly SessionEntry[] } }) => void | Promise<void>): void;
  appendEntry(customType: string, data: unknown, options: { startupBookkeeping: boolean }): void;
};

// task_send labels every outcome with a kind. These are the ones in which native took the message; any other kind
// (not_found, scope_denied, not_continuable, admission_refused, ...) is a refusal whose text goes back to the composer.
const DELIVERED = new Set(["steered", "revived", "queued", "capacity_deferred"]);

export default function taskMessageExtension(pi: Api): void {
  if (pi.sessionContext?.["created_by"] === ORIGIN_CONTEXT.created_by) {
    pi.on("session_start", (_event, ctx) => {
      const entries = ctx.sessionManager.getEntries();
      // A session that already holds a conversation or a marker was not created by this open.
      if (entries.some(entry => entry.type === "message" || (entry.type === "custom" && entry.customType === ORIGIN_ENTRY))) return;
      // Bookkeeping, so a session closed before its first message still leaves no file behind.
      pi.appendEntry(ORIGIN_ENTRY, { createdBy: ORIGIN_CONTEXT.created_by, surface: pi.sessionContext?.["surface"] ?? ORIGIN_CONTEXT.surface },
        { startupBookkeeping: true });
    });
  }
  pi.rpc.handle("omo-ui.task.send", async (data) => {
    if (typeof data !== "object" || data === null || !("taskId" in data) || !("message" in data)
      || typeof data.taskId !== "string" || typeof data.message !== "string" || !data.message.trim()) {
      throw new Error("Invalid child task message");
    }
    const result = await pi.executeTool("task_send", { to: data.taskId, message: data.message, ...("allScope" in data && data.allScope === true ? { all_scope: true } : {}) }, { activateInactiveTool: true });
    const failed = typeof result.details === "object" && result.details !== null && "kind" in result.details
      && !(typeof result.details.kind === "string" && DELIVERED.has(result.details.kind));
    if (result.isError || failed) throw new Error(result.content.filter(part => part.type === "text").map(part => part.text ?? "").join("\n"));
    return { delivered: true };
  });
  pi.rpc.handle("omo-ui.task.cancel", async (data) => {
    if (typeof data !== "object" || data === null || !("taskId" in data)
      || typeof data.taskId !== "string" || !data.taskId.trim()
      || ("reason" in data && typeof data.reason !== "string")) {
      throw new Error("Invalid child task cancellation");
    }
    const result = await pi.executeTool("task_cancel", { task_id: data.taskId, ...("reason" in data ? { reason: data.reason } : {}) }, { activateInactiveTool: true });
    if (result.isError) throw new Error(result.content.filter(part => part.type === "text").map(part => part.text ?? "").join("\n"));
    const status = typeof result.details === "object" && result.details !== null && "status" in result.details ? result.details.status : undefined;
    return { cancelled: true, ...(status === undefined ? {} : { status }) };
  });
}
