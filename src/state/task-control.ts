export async function cancelChildTask(parentThreadId: string, taskId: string): Promise<void> {
  await window.omo.request("extension_request", {
    threadId: parentThreadId,
    name: "omo-ui.task.cancel",
    data: { taskId },
  });
}
