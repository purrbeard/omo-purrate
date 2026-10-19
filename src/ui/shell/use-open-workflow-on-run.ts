import { useEffect, useRef } from "react";
import { selectMainThreadId } from "../../state/selectors";
import { useAppSelector } from "../app-context";
import { uiState, useUiState } from "../ui-state";

/**
 * Opens the workflow graph in the right dock when a new live run appears for the active thread and the
 * openWorkflowOnRun preference is on. Runs present when the thread becomes active, and runs restored from history
 * or a task store, only seed the seen set.
 */
export function useOpenWorkflowOnRun(): void {
  const enabled = useUiState().preferences?.openWorkflowOnRun ?? false;
  const threadId = useAppSelector(selectMainThreadId);
  const runOrder = useAppSelector(state => (threadId === null ? undefined : state.conversations[threadId]?.live.runOrder));
  const runsSource = useAppSelector(state => (threadId === null ? undefined : state.conversations[threadId]?.live.runsSource));
  const seen = useRef<{ threadId: string | null; ids: Set<string> } | null>(null);

  useEffect(() => {
    if (seen.current === null || seen.current.threadId !== threadId) {
      seen.current = { threadId, ids: new Set(runOrder ?? []) };
      return;
    }
    let fresh = false;
    for (const id of runOrder ?? []) {
      if (seen.current.ids.has(id)) continue;
      seen.current.ids.add(id);
      if (runsSource === "live") fresh = true;
    }
    if (fresh && enabled) uiState.openWork("graph");
  }, [threadId, runOrder, runsSource, enabled]);
}
