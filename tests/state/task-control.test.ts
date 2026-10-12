import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelChildTask } from "../../src/state/task-control";

afterEach(() => { vi.unstubAllGlobals(); });

describe("cancelChildTask", () => {
  it("routes cancellation through the parent thread extension request", async () => {
    const request = vi.fn().mockResolvedValue({ cancelled: true });
    vi.stubGlobal("window", { omo: { request } });
    await cancelChildTask("parent-thread", "st_child");
    expect(request).toHaveBeenCalledExactlyOnceWith("extension_request", {
      threadId: "parent-thread",
      name: "omo-ui.task.cancel",
      data: { taskId: "st_child" },
    });
  });
  it("waits for the bridge result and propagates request errors", async () => {
    const error = new Error("No task found");
    const request = vi.fn().mockRejectedValue(error);
    vi.stubGlobal("window", { omo: { request } });
    await expect(cancelChildTask("parent-thread", "st_missing")).rejects.toBe(error);
  });
});
