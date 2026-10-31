import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { normalizeHolders } from "../../../shared/session-held";
import type { SessionHolder } from "../../../shared/session-held";
import { useActions, useAppSelector } from "../app-context";

type HolderMap = Readonly<Record<string, readonly SessionHolder[]>>;
const NO_HOLDERS: HolderMap = {};
const HoldersContext = createContext<HolderMap>(NO_HOLDERS);
export const SessionHoldersProvider = HoldersContext.Provider;
export function useThreadHolders(threadId: string): readonly SessionHolder[] | undefined {
  return useContext(HoldersContext)[threadId];
}

/** Initial inspection plus native ownership lifecycle edges; focus is only a manual refresh, never a release signal. */
export function useSessionHolders(threadIds: readonly string[]): HolderMap {
  const actions = useActions();
  const key = useMemo(() => [...new Set(threadIds)].sort().join(","), [threadIds]);
  const [holders, setHolders] = useState<HolderMap>(NO_HOLDERS);
  const paths = useAppSelector(state => key === "" ? "" : key.split(",").map(id => state.threads[id]?.path ?? "").join("\n"));
  useEffect(() => {
    if (key === "") { setHolders(NO_HOLDERS); return; }
    let current = true;
    let revision = 0;
    const ids = new Set(key.split(","));
    const refresh = (): void => {
      const read = ++revision;
      actions.inspectSessions([...ids]).then(
        inspection => { if (current && read === revision) setHolders(inspection.holders); },
        () => { /* A failed query cannot prove a foreign writer released ownership. */ },
      );
    };
    // Register before the initial inspection so an owner release cannot fall into the startup gap.
    const unsubscribe = window.omo.onNotification(notification => {
      if (!current || notification.method !== "extension_event") return;
      const event = notification.params as { threadId?: unknown; name?: unknown; data?: unknown };
      if (event.name !== "omo.session.ownership" || typeof event.threadId !== "string" || !ids.has(event.threadId) || typeof event.data !== "object" || event.data === null) return;
      const data = event.data as Record<string, unknown>;
      const threadId = event.threadId;
      revision += 1;
      setHolders(previous => {
        const next = { ...previous };
        if (data["writable"] === true) delete next[threadId];
        else next[threadId] = normalizeHolders(data["holders"]);
        return next;
      });
    });
    refresh();
    window.addEventListener("focus", refresh);
    return () => { current = false; unsubscribe(); window.removeEventListener("focus", refresh); };
  }, [actions, key, paths]);
  return holders;
}
