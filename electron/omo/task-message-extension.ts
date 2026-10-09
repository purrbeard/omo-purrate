type ToolResult = { readonly isError?: boolean; readonly content: readonly { readonly type: string; readonly text?: string }[]; readonly details?: unknown };
type Api = {
  readonly rpc: { handle(name: string, handler: (data: unknown) => Promise<unknown>): void };
  executeTool(name: string, args: object, options: { activateInactiveTool: boolean }): Promise<ToolResult>;
};

// task_send labels every outcome with a kind. These are the ones in which native took the message; any other kind
// (not_found, scope_denied, not_continuable, admission_refused, ...) is a refusal whose text goes back to the composer.
const DELIVERED = new Set(["steered", "revived", "queued", "capacity_deferred"]);

export default function taskMessageExtension(pi: Api): void {
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
}
