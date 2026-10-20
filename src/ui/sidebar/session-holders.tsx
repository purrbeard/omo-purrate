import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { SessionHolder } from "../../../shared/session-held";
import { useActions } from "../app-context";

type HolderMap = Readonly<Record<string, readonly SessionHolder[]>>;

const NO_HOLDERS: HolderMap = {};
const HoldersContext = createContext<HolderMap>(NO_HOLDERS);

/** Provides the holders {@link useSessionHolders} found to the thread rows below it. */
export const SessionHoldersProvider = HoldersContext.Provider;

/** @returns the live foreign holders of one session, or undefined when nobody else holds it */
export function useThreadHolders(threadId: string): readonly SessionHolder[] | undefined {
  return useContext(HoldersContext)[threadId];
}

/**
 * Looks up which of the sessions another omo process holds open: when the id set changes and whenever the window
 * regains focus (no timer; the main process caches process lookups for a few seconds).
 */
export function useSessionHolders(threadIds: readonly string[]): HolderMap {
  const actions = useActions();
  const key = useMemo(() => [...new Set(threadIds)].sort().join(","), [threadIds]);
  const [holders, setHolders] = useState<HolderMap>(NO_HOLDERS);
  useEffect(() => {
    if (key === "") { setHolders(NO_HOLDERS); return; }
    let current = true;
    const refresh = (): void => {
      actions.inspectSessions(key.split(",")).then(
        (inspection) => { if (current) setHolders(inspection.holders); },
        () => { /* a failed lookup keeps the last known badges */ },
      );
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { current = false; window.removeEventListener("focus", refresh); };
  }, [actions, key]);
  return holders;
}
