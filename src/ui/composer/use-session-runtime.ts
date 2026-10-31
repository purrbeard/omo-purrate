import { useEffect, useState } from "react";
import type { SessionRuntimeState } from "../../../shared/protocol";
import { errorMessage } from "../settings/diagnostics";

export function useSessionRuntime(threadId: string | null) {
  const [revision, setRevision] = useState(0);
  const [entry, setEntry] = useState<{ threadId: string; runtime: SessionRuntimeState | null; error: string | null } | null>(null);
  useEffect(() => window.omo.onNotification(event => {
    const params = event.params;
    if (typeof params !== "object" || params === null || !("threadId" in params) || params.threadId !== threadId) return;
    if (event.method === "thread/status/changed" || (event.method === "extension_event" && "name" in params && params.name === "omo.runtime.changed")) setRevision(value => value + 1);
  }), [threadId]);
  useEffect(() => {
    if (threadId === null) return;
    let current = true;
    void window.omo.request("thread/runtime/get", { threadId }).then(
      ({ runtime }) => { if (current) setEntry({ threadId, runtime, error: null }); },
      (reason: unknown) => { if (current) setEntry({ threadId, runtime: null, error: errorMessage(reason) }); },
    );
    return () => { current = false; };
  }, [threadId, revision]);
  return { runtime: entry?.threadId === threadId ? entry.runtime : null, error: entry?.threadId === threadId ? entry.error : null,
    refresh: () => setRevision(value => value + 1) };
}
