import { useEffect, useMemo, useState } from "react";
import { Check, Import, Plus, Search, X } from "lucide-react";
import { useAppStore } from "../../state";
import { useActions, useAppSelector } from "../app-context";
import { useT } from "../../i18n";
import { uiState, useUiState } from "../ui-state";
import { threadTitle } from "../conversation/format";
import { Button, focusRing } from "../kit";
import { errorMessage } from "../settings/diagnostics";
import { Checkbox, SessionTable, cellClass, pathCellClass, rowClass, useUpdatedFormat } from "../settings/ImportTable";
import { ErrorText } from "../settings/SettingsCard";
import { WideDialog } from "../settings/WideDialog";

/** Existing sessions as a table: search, bulk add/remove from the managed list, and per-row manage toggles. */
export function NativeSessionsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const actions = useActions();
  const store = useAppStore();
  const updated = useUpdatedFormat();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failedCursor, setFailedCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
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
        setError(t("shell.managed.searchFailedPlain"));
      }
      setLoading(false);
    });
  }, [actions, store, searching, cursor, loading, busy, failedCursor, t]);
  const matches = useMemo(() => order.filter(id => {
    const thread = threads[id];
    return thread !== undefined && `${id} ${threadTitle(thread, t("shell.newSession"))} ${thread.cwd}`.toLowerCase().includes(query.toLowerCase().trim());
  }), [order, threads, query]);
  const selected = matches.filter(id => checked.has(id));

  async function setManaged(ids: readonly string[], on: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      for (const id of ids) await actions.manageThread(id, on);
      setChecked(new Set());
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function more(): Promise<void> {
    setBusy(true);
    setError(null);
    try { await actions.refreshThreads(true); }
    finally {
      if (store.getState().threadsCursor === cursor) {
        setFailedCursor(cursor);
        setError(t("shell.managed.searchFailedPlain"));
      } else {
        setFailedCursor(null);
      }
      setBusy(false);
    }
  }
  const toggleChecked = (ids: readonly string[], on: boolean): void => setChecked(current => {
    const next = new Set(current);
    for (const id of ids) if (on) next.add(id); else next.delete(id);
    return next;
  });

  return (
    <WideDialog
      title={t("shell.managed.dialogTitle")}
      description={t("shell.managed.inventoryHint")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" icon={<Import aria-hidden="true" />} data-testid="native-sessions-import" onClick={() => { onClose(); uiState.setSessionImportOpen(true); }}>
            {t("shell.import.open")}
          </Button>
          <Button variant="outline" data-testid="native-sessions-close" onClick={onClose}>{t("shell.managed.close")}</Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="native-sessions-dialog">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative box-border flex h-9 min-w-60 flex-1 items-center gap-2 rounded-md border border-solid border-input bg-background px-2.5 text-muted-foreground focus-within:border-ring">
            <Search aria-hidden="true" className="size-3.5 flex-none" />
            <input
              className={`m-0 h-full min-w-0 flex-1 border-0 bg-transparent p-0 [font-family:inherit] text-sm text-foreground outline-none placeholder:text-muted-foreground`}
              data-testid="native-sessions-search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label={t("shell.managed.searchPlain")}
              placeholder={t("shell.managed.searchPlain")}
            />
          </label>
          <p className="m-0 text-xs text-muted-foreground tabular-nums" role="status">
            {searching && cursor !== null && error === null ? t("shell.managed.searchingPlain", { count: order.length }) : t("shell.managed.loaded", { count: order.length })}
          </p>
        </div>
        {selected.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-sm" data-testid="native-sessions-bulk">
            <span className="mr-auto tabular-nums">{t("shell.managed.selected", { count: selected.length })}</span>
            <Button variant="outline" size="sm" icon={<Plus aria-hidden="true" />} disabled={busy} onClick={() => void setManaged(selected, true)}>{t("shell.managed.addSelected")}</Button>
            <Button variant="outline" size="sm" icon={<X aria-hidden="true" />} disabled={busy} onClick={() => void setManaged(selected, false)}>{t("shell.managed.removeSelected")}</Button>
          </div>
        )}
        {error !== null && <ErrorText>{error}</ErrorText>}
        <SessionTable
          maxHeight="flex-1"
          testId="native-sessions-list"
          columns={["", "w-[24%]", "w-36", "w-28", "w-28"]}
          head={
            <tr>
              <th scope="col" className="text-center">
                <Checkbox
                  aria-label={t("shell.import.selectAll")}
                  disabled={busy || matches.length === 0}
                  checked={matches.length > 0 && selected.length === matches.length}
                  indeterminate={selected.length > 0 && selected.length < matches.length}
                  onChange={event => toggleChecked(matches, event.target.checked)}
                />
              </th>
              <th scope="col">{t("shell.import.col.title")}</th>
              <th scope="col">{t("shell.import.col.path")}</th>
              <th scope="col">{t("shell.import.col.updated")}</th>
              <th scope="col">{t("shell.import.col.origin")}</th>
              <th scope="col">{t("shell.import.col.sidebar")}</th>
            </tr>
          }
        >
          <tbody>
            {matches.map(id => {
              const thread = threads[id]!;
              const included = managed.includes(id);
              const title = threadTitle(thread, t("shell.newSession"));
              return (
                <tr className={rowClass} key={id} data-testid="native-session-row" data-thread-id={id}>
                  <td className="text-center">
                    <Checkbox aria-label={title} disabled={busy} checked={checked.has(id)} onChange={event => toggleChecked([id], event.target.checked)} />
                  </td>
                  <td className={cellClass}>
                    <button type="button" className={`m-0 max-w-full cursor-pointer truncate rounded-sm border-0 bg-transparent p-0 text-left [font-family:inherit] text-sm font-medium text-foreground hover:underline ${focusRing}`}
                      title={`${title}\n${id}`} aria-label={`${t("shell.managed.open")}: ${title}`} disabled={busy} onClick={() => { void actions.openThread(id); onClose(); }}>
                      {title}
                    </button>
                  </td>
                  <td className={pathCellClass} title={thread.cwd}><bdi dir="ltr">{thread.cwd}</bdi></td>
                  <td className="truncate text-xs text-muted-foreground tabular-nums">{updated(thread.updatedAt)}</td>
                  <td className="truncate text-xs">{t(`shell.creator.${origins[id] ?? "unknown"}`)}</td>
                  <td>
                    <Button variant={included ? "secondary" : "ghost"} size="sm" className="w-full" disabled={busy} data-testid="native-session-manage" aria-pressed={included}
                      aria-label={t(included ? "shell.managed.remove" : "shell.managed.add")}
                      icon={included ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />} onClick={() => void setManaged([id], !included)}>
                      {t(included ? "shell.managed.managed" : "shell.managed.addShort")}
                    </Button>
                  </td>
                </tr>
              );
            })}
            {matches.length === 0 && (!searching || cursor === null) && (
              <tr><td colSpan={6} className="px-2 py-6 text-center text-sm text-muted-foreground" data-testid="native-sessions-no-match">{t("shell.managed.noMatchPlain")}</td></tr>
            )}
          </tbody>
        </SessionTable>
        {cursor !== null && (
          <Button variant="outline" size="sm" className="self-start" disabled={busy || loading} data-testid="native-sessions-more" onClick={() => void more()}>
            {t("shell.managed.loadMorePlain")}
          </Button>
        )}
      </div>
    </WideDialog>
  );
}
