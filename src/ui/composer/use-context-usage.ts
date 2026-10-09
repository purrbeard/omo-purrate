import { useEffect, useState } from "react";
import type { ContextUsage } from "../../../shared/workbench";
import { selectActiveSessionModel } from "../../state";
import { useAppSelector } from "../app-context";
import { useNativeCatalog } from "./use-native-catalog";

export interface ContextGaugeUsage {
  tokens: number | null;
  window: number;
  compacted: boolean;
}

export function useContextUsage(): ContextGaugeUsage | null {
  const threadId = useAppSelector(state => state.activeThreadId);
  const thread = useAppSelector(state => threadId === null ? null : state.threads[threadId] ?? null);
  const session = useAppSelector(selectActiveSessionModel);
  const modelId = useAppSelector(state => state.composer.modelId);
  const completed = useAppSelector(state => threadId === null ? 0 :
    state.conversations[threadId]?.turns.filter(turn => turn.status === "completed").length ?? 0);
  const compactions = useAppSelector(state => threadId === null ? 0 :
    state.conversations[threadId]?.turns.reduce((count, turn) => count + turn.items.reduce((total, entry) =>
      total + (entry.item.type === "contextCompaction" ? entry.streaming ? 1 : 2 : 0), 0), 0) ?? 0);
  const catalog = useNativeCatalog(thread?.cwd ?? null, thread?.path != null);
  const path = thread?.path ?? null;
  const [entry, setEntry] = useState<{ threadId: string; path: string; usage: ContextUsage } | null>(null);

  useEffect(() => {
    if (threadId === null || path === null) return;
    let current = true;
    void window.omo.loadContextUsage(path).then(usage => {
      if (current) setEntry({ threadId, path, usage });
    }).catch(() => {
      if (current) setEntry(null);
    });
    return () => { current = false; };
  }, [threadId, path, completed, compactions]);

  if (entry === null || entry.threadId !== threadId || entry.path !== path || catalog === null) return null;
  const { usage } = entry;
  if (usage.tokens === null && !usage.compacted) return null;
  const usageKey = usage.provider !== null && usage.model !== null ? `${usage.provider}/${usage.model}` : "";
  const sessionKey = session === null ? "" : `${session.modelProvider}/${session.model}`;
  const contextWindow = catalog.contextWindows[usageKey] ?? catalog.contextWindows[sessionKey] ??
    (modelId === null ? undefined : catalog.contextWindows[modelId]);
  if (contextWindow === undefined || contextWindow <= 0) return null;
  return { tokens: usage.tokens, window: contextWindow, compacted: usage.compacted };
}
