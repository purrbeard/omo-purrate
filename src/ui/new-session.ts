import { useCallback, useContext } from "react";
import { useT } from "../i18n";
import { StoreContext, useActions } from "./app-context";
import { freshThreads } from "./projects/fresh-thread";
import { uiState } from "./ui-state";

/**
 * The new-session flow, with no chooser in between: a thread starts at once in the default project (the last
 * workspace, which Settings > General also sets) and the composer opens on it; the project chip above the composer
 * switches project. Only when no default is known does the native folder picker open. Resolves the new thread id,
 * or null when the folder choice was cancelled or the start failed (the failure is already a notice).
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
    // actions.newThread records the workspace through the bridge alone, so the copy in uiState can be behind.
    const preferences = await window.omo.getPreferences();
    uiState.setPreferences(preferences);
    const cwd = preferences.lastWorkspace ?? (await window.omo.pickDirectory(null));
    if (cwd === null) return null;
    const threadId = await actions.newThread(cwd);
    if (threadId !== null) freshThreads.mark(threadId);
    return threadId;
  }, [actions, store, t]);
}
