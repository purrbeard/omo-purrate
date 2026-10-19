import { useEffect, useState } from "react";
import type { ContextUsage } from "../../../shared/workbench";
import type { SessionStats } from "../../../shared/protocol";
import { selectActiveSessionModel } from "../../state";
import { useAppSelector } from "../app-context";
import { useNativeCatalog } from "./use-native-catalog";

export interface ContextGaugeUsage {
  tokens: number | null;
  window: number;
  compacted: boolean;
  /** The whole session's tokens and cost from omo's `get_session_stats`; null while omo has not answered. */
  totalTokens: number | null;
  cost: number | null;
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
  const [stats, setStats] = useState<{ threadId: string; stats: SessionStats } | null>(null);

  useEffect(() => {
    if (threadId === null || path === null) return;
    let current = true;
    void window.omo.loadContextUsage(path).then(usage => {
      if (current) setEntry({ threadId, path, usage });
    }).catch(() => {
      if (current) setEntry(null);
    });
    // omo's own totals: the gauge prefers its context window and shows the session cost and tokens in the tooltip.
    void window.omo.request("thread/stats", { threadId }).then(({ stats: loaded }) => {
      if (current) setStats({ threadId, stats: loaded });
    }).catch(() => {
      if (current) setStats(null);
    });
    return () => { current = false; };
  }, [threadId, path, completed, compactions]);

  if (entry === null || entry.threadId !== threadId || entry.path !== path) return null;
  const { usage } = entry;
  const live = stats !== null && stats.threadId === threadId ? stats.stats : null;
  const context = live?.contextUsage ?? null;
  const tokens = context === null ? usage.tokens : context.tokens;
  if (tokens === null && !usage.compacted) return null;
  const usageKey = usage.provider !== null && usage.model !== null ? `${usage.provider}/${usage.model}` : "";
  const sessionKey = session === null ? "" : `${session.modelProvider}/${session.model}`;
  const contextWindow = context?.contextWindow ?? (catalog === null ? undefined : catalog.contextWindows[usageKey] ?? catalog.contextWindows[sessionKey] ??
    (modelId === null ? undefined : catalog.contextWindows[modelId]));
  if (contextWindow === undefined || contextWindow <= 0) return null;
  return {
    tokens, window: contextWindow, compacted: usage.compacted,
    totalTokens: live === null ? null : live.tokens.total, cost: live === null ? null : live.cost,
  };
}
