import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../state";
import { useActions, useAppSelector } from "../app-context";
import { useT } from "../../i18n";
import { useUiState } from "../ui-state";
import { threadTitle } from "../conversation/format";
import { Button, Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import css from "./Sidebar.module.css";

export function NativeSessionsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const actions = useActions();
  const store = useAppStore();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failedCursor, setFailedCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { preferences } = useUiState();
  const managed = preferences?.managedThreadIds ?? [];
  const threads = useAppSelector(s => s.threads);
  const order = useAppSelector(s => s.threadOrder);
  const cursor = useAppSelector(s => s.threadsCursor);
  const origins = useAppSelector(s => s.threadOrigins);
  const searching = query.trim() !== "";
  useEffect(() => {
    if (!searching || cursor === null || loading || busy || failedCursor === cursor) return;
    setLoading(true);
    void actions.refreshThreads(true).finally(() => {
      if (store.getState().threadsCursor === cursor) {
        setFailedCursor(cursor);
        setError(t("shell.managed.searchFailed"));
      }
      setLoading(false);
    });
  }, [actions, store, searching, cursor, loading, busy, failedCursor, t]);
  const matches = useMemo(() => order.filter(id => {
    const thread = threads[id];
    return thread !== undefined && `${id} ${threadTitle(thread, t("shell.newSession"))} ${thread.cwd}`.toLowerCase().includes(query.toLowerCase().trim());
  }), [order, threads, query]);
  async function toggle(id: string) {
    setBusy(true);
    setError(null);
    try { await actions.manageThread(id, !managed.includes(id)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function more() {
    setBusy(true);
    setError(null);
    try { await actions.refreshThreads(true); }
    finally {
      if (store.getState().threadsCursor === cursor) {
        setFailedCursor(cursor);
        setError(t("shell.managed.searchFailed"));
      } else {
        setFailedCursor(null);
      }
      setBusy(false);
    }
  }
  return <Modal open onClose={onClose} title={t("shell.managed.inventory")} closeLabel={t("common.close")} footer={<Button variant="outline" data-testid="native-sessions-close" onClick={onClose}>{t("shell.managed.close")}</Button>}>
    <div data-testid="native-sessions-dialog">
    <p>{t("shell.managed.inventoryHint")}</p>
    <input className={css.nativeSearch} data-testid="native-sessions-search" value={query} onChange={e => setQuery(e.target.value)} aria-label={t("shell.managed.search")} placeholder={t("shell.managed.search")} />
    <p role="status">{searching && cursor !== null && error === null ? t("shell.managed.searching", { count: order.length }) : t("shell.managed.loaded", { count: order.length })}</p>
    {error !== null && <p role="alert">{error}</p>}
    <div className={css.nativeList} data-testid="native-sessions-list">
      {matches.map(id => {
        const thread = threads[id]!;
        const included = managed.includes(id);
        return <div className={css.nativeRow} key={id} data-testid="native-session-row" data-thread-id={id}>
          <div className={css.nativeInfo}><strong>{threadTitle(thread, t("shell.newSession"))}</strong><span>{id}</span><span>{thread.cwd}</span><span>{t(`shell.creator.${origins[id] ?? "unknown"}`)}</span></div>
          <Button variant="outline" disabled={busy} data-testid="native-session-manage" aria-pressed={included} onClick={() => void toggle(id)}>{t(included ? "shell.managed.remove" : "shell.managed.add")}</Button>
          <Button variant="outline" disabled={busy} onClick={() => { void actions.openThread(id); onClose(); }}>{t("shell.managed.open")}</Button>
        </div>;
      })}
      {matches.length === 0 && (!searching || cursor === null) && <p data-testid="native-sessions-no-match">{t("shell.managed.noMatch")}</p>}
    </div>
    {cursor !== null && <Button variant="outline" disabled={busy || loading} data-testid="native-sessions-more" onClick={() => void more()}>{t("shell.managed.loadMore")}</Button>}
    </div>
  </Modal>;
}
