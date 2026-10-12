interface AttentionWindow {
  setProgressBar(p: number, o?: { mode: string }): void;
  flashFrame(f: boolean): void;
  isFocused(): boolean;
  isDestroyed(): boolean;
}

export function createAttentionTracker(deps: { window: () => AttentionWindow | null }) {
  const runningThreads = new Set<string>();
  let disposed = false;

  function getWindow(): AttentionWindow | null {
    if (disposed) return null;
    const window = deps.window();
    return window && !window.isDestroyed() ? window : null;
  }

  function updateProgress(): void {
    const window = getWindow();
    if (!window) return;
    if (runningThreads.size > 0) window.setProgressBar(2, { mode: "indeterminate" });
    else window.setProgressBar(-1);
  }

  function requestAttention(): void {
    const window = getWindow();
    if (window && !window.isFocused()) window.flashFrame(true);
  }

  return {
    onNotification(n: { method: string; params?: unknown }): void {
      if (disposed) return;
      if (n.method !== "turn/started" && n.method !== "turn/completed" && n.method !== "thread/status/changed") return;
      if (!n.params || typeof n.params !== "object") return;
      const params = n.params as { threadId?: unknown; status?: { type?: unknown } | null };
      if (typeof params.threadId !== "string") return;
      if (n.method === "turn/started") runningThreads.add(params.threadId);
      else if (n.method === "turn/completed" || params.status?.type !== "active") runningThreads.delete(params.threadId);
      updateProgress();
      if (n.method === "turn/completed") requestAttention();
    },
    onServerRequest: requestAttention,
    onFocus(): void {
      getWindow()?.flashFrame(false);
    },
    dispose(): void {
      const window = getWindow();
      window?.setProgressBar(-1);
      window?.flashFrame(false);
      runningThreads.clear();
      disposed = true;
    },
  };
}
