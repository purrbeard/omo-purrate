import { useCallback } from "react";
import { useT } from "../../i18n";
import { useAppStore } from "../../state";
import { useActions } from "../app-context";
import { threadTitle } from "../conversation/format";
import { backgroundMessages, capBackground, sidePrompt } from "./background";

/**
 * @returns a function that asks a question in a new side chat of the active thread, attaching the thread's capped
 *   background unless its context chip was removed; without an active thread it only opens the panel
 */
export function useAskSide(): (question: string) => Promise<boolean> {
  const t = useT();
  const actions = useActions();
  const store = useAppStore();
  const fallbackTitle = t("conversation.header.newSession");
  return useCallback(
    async (question: string) => {
      const state = store.getState();
      const parentId = state.activeThreadId;
      const parent = parentId === null ? undefined : state.threads[parentId];
      if (parentId === null || parent === undefined) {
        actions.setSidePanel(true);
        return false;
      }
      const context = state.btw.detached[parentId] !== true;
      const messages = context ? capBackground(backgroundMessages(state.conversations[parentId])) : null;
      const prompt = sidePrompt({ title: threadTitle(parent, fallbackTitle), cwd: parent.cwd, messages, question });
      return actions.askNewSide({ question, prompt, context });
    },
    [actions, store, fallbackTitle],
  );
}
