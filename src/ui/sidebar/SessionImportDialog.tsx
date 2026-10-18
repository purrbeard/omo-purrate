import { useEffect, useMemo, useState } from "react";
import { Button, Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ImportCandidate } from "../../../shared/ipc";
import { useT } from "../../i18n";
import { useActions } from "../app-context";
import { uiState, useUiState } from "../ui-state";
import css from "./SessionImportDialog.module.css";

type Group = "own" | "machine" | "scratch" | "damaged";
const GROUPS: readonly Group[] = ["own", "machine", "scratch", "damaged"];
const GROUP_LABEL = { own: "shell.import.groupOwn", machine: "shell.import.groupMachine", scratch: "shell.import.groupScratch", damaged: "shell.import.groupDamaged" } as const;

function groupOf(candidate: ImportCandidate): Group {
  if (!candidate.importable) return "damaged";
  if (candidate.location !== null) return "scratch";
  return candidate.evidence === "app" || candidate.evidence === "terminal" ? "own" : "machine";
}

export function SessionImportDialog() {
  const t = useT();
  const actions = useActions();
  const { preferences } = useUiState();
  const managed = useMemo(() => new Set(preferences?.managedThreadIds ?? []), [preferences?.managedThreadIds]);
  const [items, setItems] = useState<ImportCandidate[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [emptyCount, setEmptyCount] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (from: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const page = await actions.loadImportCandidates(from);
      setItems(current => {
        const known = new Set(current.map(item => item.sessionPath));
        return [...current, ...page.items.filter(item => !known.has(item.sessionPath))];
      });
      setSelected(current => new Set([...current, ...page.items.filter(item => item.recommended && !managed.has(item.id)).map(item => item.sessionPath)]));
      setCursor(page.nextCursor);
      if (from === null) setEmptyCount(page.emptyCount);
    } catch (cause) {
      setError(t("shell.import.failed", { message: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(null); }, []);

  const close = () => { uiState.setSessionImportOpen(false); };
  const finish = async (paths: string[] | null) => {
    setBusy(true);
    setError(null);
    try {
      if (paths === null) await actions.skipSessionImport();
      else await actions.importSessions(paths);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (path: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const chosen = items.filter(item => selected.has(item.sessionPath) && item.importable && !managed.has(item.id)).map(item => item.sessionPath);

  return <Modal open onClose={() => void finish(null)} title={t("shell.import.title")} closeLabel={t("shell.import.skip")} footer={<div className={css.footer}>
    <Button variant="outline" disabled={busy} data-testid="session-import-skip" onClick={() => void finish(null)}>{t("shell.import.skip")}</Button>
    <Button disabled={busy || loading || chosen.length === 0} data-testid="session-import-confirm" onClick={() => void finish(chosen)}>{t("shell.import.confirm", { count: chosen.length })}</Button>
  </div>}>
    <div className={css.body} data-testid="session-import-dialog">
      <p className={css.hint}>{t("shell.import.hint")}</p>
      {emptyCount > 0 && <p className={css.hint} data-testid="session-import-empty-count">{t("shell.import.empty", { count: emptyCount })}</p>}
      {error !== null && <p role="alert">{error}</p>}
      <div className={css.list}>
        {GROUPS.map(group => {
          const rows = items.filter(item => groupOf(item) === group);
          if (rows.length === 0) return null;
          return <section key={group} className={css.group} data-testid={`session-import-group-${group}`}>
            <h3>{t(GROUP_LABEL[group])}</h3>
            {rows.map(item => {
              const already = managed.has(item.id);
              const id = `session-import-${item.id}`;
              return <label key={item.sessionPath} htmlFor={id} className={css.row} data-testid="session-import-row" data-session-id={item.id} data-evidence={item.evidence}>
                <input id={id} type="checkbox" disabled={!item.importable || already || busy}
                  checked={already || (item.importable && selected.has(item.sessionPath))} onChange={() => toggle(item.sessionPath)} />
                <span className={css.info}>
                  <strong>{item.name ?? item.preview?.split("\n")[0] ?? item.id}</strong>
                  <span>{item.cwd}</span>
                  <span>{[t(`shell.import.evidence.${item.evidence}`), t("shell.import.messages", { count: item.userMessages }), new Date(item.updatedAtMs).toLocaleString(),
                    ...(already ? [t("shell.import.managed")] : [])].join(" · ")}</span>
                </span>
              </label>;
            })}
          </section>;
        })}
        {loading && <p role="status">{t("shell.import.loading")}</p>}
        {!loading && items.length === 0 && error === null && <p data-testid="session-import-nothing">{t("shell.import.nothing")}</p>}
      </div>
      {cursor !== null && <Button variant="outline" disabled={loading || busy} data-testid="session-import-more" onClick={() => void load(cursor)}>{t("shell.import.more")}</Button>}
    </div>
  </Modal>;
}
