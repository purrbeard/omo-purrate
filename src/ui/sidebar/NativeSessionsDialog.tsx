import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../../state";
import { useActions, useAppSelector } from "../app-context";
import { useT } from "../../i18n";
import { uiState, useUiState } from "../ui-state";
import { threadTitle } from "../conversation/format";
import { Button, Dialog, Input, InputError } from "../kit";
import { errorText } from "../notices/error-text";

export function NativeSessionsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const actions = useActions();
  const store = useAppStore();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failedCursor, setFailedCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
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
    catch (e) { setError(errorText(e, t).text); }
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
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content initialFocus={search}>
        <div className="flex min-h-0 flex-col gap-3" data-testid="native-sessions-dialog">
          <Dialog.Title>{t("shell.managed.inventory")}</Dialog.Title>
          <Dialog.Description>{t("shell.managed.inventoryHint")}</Dialog.Description>
          <Input ref={search} data-testid="native-sessions-search" value={query} onValueChange={setQuery} aria-label={t("shell.managed.search")} placeholder={t("shell.managed.search")} />
          <p className="m-0 text-xs text-muted-foreground" role="status">
            {searching && cursor !== null && error === null ? t("shell.managed.searching", { count: order.length }) : t("shell.managed.loaded", { count: order.length })}
          </p>
          {error !== null && <InputError role="alert">{error}</InputError>}
          <div className="max-h-[min(52vh,440px)] overflow-y-auto rounded-md border border-solid border-border" data-testid="native-sessions-list">
            {matches.map(id => {
              const thread = threads[id]!;
              const included = managed.includes(id);
              return (
                <div className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-border px-3 py-2.5 last:border-b-0" key={id} data-testid="native-session-row" data-thread-id={id}>
                  <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-0.5">
                    <strong className="truncate text-sm font-medium text-foreground">{threadTitle(thread, t("shell.newSession"))}</strong>
                    <span className="text-xs text-muted-foreground wrap-anywhere">{thread.cwd}</span>
                    <span className="text-xs text-muted-foreground wrap-anywhere">{id} · {t(`shell.creator.${origins[id] ?? "unknown"}`)}</span>
                  </div>
                  <Button variant={included ? "secondary" : "outline"} size="sm" disabled={busy} data-testid="native-session-manage" aria-pressed={included} onClick={() => void toggle(id)}>
                    {t(included ? "shell.managed.remove" : "shell.managed.add")}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void actions.openThread(id); onClose(); }}>{t("shell.managed.open")}</Button>
                </div>
              );
            })}
            {matches.length === 0 && (!searching || cursor === null) && <p className="m-0 px-3 py-6 text-center text-sm text-muted-foreground" data-testid="native-sessions-no-match">{t("shell.managed.noMatch")}</p>}
          </div>
          <Dialog.Footer className="justify-between">
            <div className="flex flex-wrap gap-2">
              {cursor !== null && <Button variant="outline" size="sm" disabled={busy || loading} data-testid="native-sessions-more" onClick={() => void more()}>{t("shell.managed.loadMore")}</Button>}
              <Button variant="ghost" size="sm" data-testid="native-sessions-import" onClick={() => { onClose(); uiState.setSessionImportOpen(true); }}>{t("shell.import.open")}</Button>
            </div>
            <Button variant="primary" data-testid="native-sessions-close" onClick={onClose}>{t("shell.managed.close")}</Button>
          </Dialog.Footer>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
