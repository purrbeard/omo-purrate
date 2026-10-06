import { useCallback, useContext } from "react";
import { useT } from "../i18n";
import { StoreContext, useActions } from "./app-context";
import { uiState } from "./ui-state";

/**
 * The new-session flow: open the native folder picker (defaulting to the last workspace),
 * then start and activate a thread there. Resolves the new thread id, or null when the
 * picker was cancelled or the start failed (the failure is already a notice).
 */
export function useNewSessionFlow(): () => Promise<string | null> {
  const actions = useActions();
  const store = useContext(StoreContext);
  const t = useT();
  return useCallback(async () => {
    if (store !== null && store.getState().bridge?.state !== "connected") {
      store.dispatch({
        type: "notice/pushed",
        notice: { id: crypto.randomUUID(), level: "error", message: t("shell.newSessionDisconnected"), threadId: null },
      });
      return null;
    }
    const last = uiState.get().preferences?.lastWorkspace ?? null;
    const cwd = await window.omo.pickDirectory(last);
    if (cwd === null) return null;
    return actions.newThread(cwd);
  }, [actions, store, t]);
}
