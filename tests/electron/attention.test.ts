import { describe, expect, it, vi } from "vitest";
import { createAttentionTracker } from "../../electron/attention";

function setup() {
  const window = {
    setProgressBar: vi.fn(),
    flashFrame: vi.fn(),
    isFocused: vi.fn(() => false),
    isDestroyed: vi.fn(() => false),
  };
  return { window, tracker: createAttentionTracker({ window: () => window }) };
}

describe("createAttentionTracker", () => {
  it("shows indeterminate progress until every running thread completes", () => {
    const { window, tracker } = setup();
    tracker.onNotification({ method: "turn/started", params: { threadId: "a" } });
    expect(window.setProgressBar).toHaveBeenLastCalledWith(2, { mode: "indeterminate" });
    tracker.onNotification({ method: "turn/started", params: { threadId: "b" } });
    tracker.onNotification({ method: "turn/completed", params: { threadId: "a" } });
    expect(window.setProgressBar).toHaveBeenLastCalledWith(2, { mode: "indeterminate" });
    expect(window.flashFrame).toHaveBeenLastCalledWith(true);
    tracker.onFocus();
    expect(window.flashFrame).toHaveBeenLastCalledWith(false);
    tracker.onNotification({ method: "turn/completed", params: { threadId: "b" } });
    expect(window.setProgressBar).toHaveBeenLastCalledWith(-1);
  });

  it("deduplicates starts and removes threads when their status becomes inactive", () => {
    const { window, tracker } = setup();
    tracker.onNotification({ method: "turn/started", params: { threadId: "a" } });
    tracker.onNotification({ method: "turn/started", params: { threadId: "a" } });
    tracker.onNotification({ method: "thread/status/changed", params: { threadId: "a", status: { type: "active" } } });
    expect(window.setProgressBar).toHaveBeenLastCalledWith(2, { mode: "indeterminate" });
    tracker.onNotification({ method: "thread/status/changed", params: { threadId: "a", status: { type: "idle" } } });
    expect(window.setProgressBar).toHaveBeenLastCalledWith(-1);
    expect(window.flashFrame).not.toHaveBeenCalled();
  });

  it("flashes for server requests only when the window is unfocused", () => {
    const { window, tracker } = setup();
    tracker.onServerRequest();
    expect(window.flashFrame).toHaveBeenCalledExactlyOnceWith(true);
    window.isFocused.mockReturnValue(true);
    tracker.onServerRequest();
    tracker.onNotification({ method: "turn/completed", params: { threadId: "a" } });
    expect(window.flashFrame).toHaveBeenCalledTimes(1);
  });

  it("ignores destroyed and missing windows", () => {
    const { window, tracker } = setup();
    window.isDestroyed.mockReturnValue(true);
    tracker.onNotification({ method: "turn/started", params: { threadId: "a" } });
    tracker.onNotification({ method: "turn/completed", params: { threadId: "a" } });
    tracker.onServerRequest();
    tracker.onFocus();
    tracker.dispose();
    expect(window.setProgressBar).not.toHaveBeenCalled();
    expect(window.flashFrame).not.toHaveBeenCalled();
    const absent = createAttentionTracker({ window: () => null });
    expect(() => {
      absent.onNotification({ method: "turn/started", params: { threadId: "a" } });
      absent.onServerRequest();
      absent.onFocus();
      absent.dispose();
    }).not.toThrow();
  });

  it("clears native attention on disposal and ignores later events", () => {
    const { window, tracker } = setup();
    tracker.onNotification({ method: "turn/started", params: { threadId: "a" } });
    tracker.dispose();
    expect(window.setProgressBar).toHaveBeenLastCalledWith(-1);
    expect(window.flashFrame).toHaveBeenLastCalledWith(false);
    window.setProgressBar.mockClear();
    window.flashFrame.mockClear();
    tracker.onNotification({ method: "turn/started", params: { threadId: "b" } });
    tracker.onServerRequest();
    tracker.onFocus();
    expect(window.setProgressBar).not.toHaveBeenCalled();
    expect(window.flashFrame).not.toHaveBeenCalled();
  });

  it("ignores unrelated notifications and missing thread ids", () => {
    const { window, tracker } = setup();
    tracker.onNotification({ method: "item/started", params: { threadId: "a" } });
    tracker.onNotification({ method: "turn/started" });
    tracker.onNotification({ method: "turn/completed", params: { threadId: 1 } });
    expect(window.setProgressBar).not.toHaveBeenCalled();
    expect(window.flashFrame).not.toHaveBeenCalled();
  });
});
