import { useContext, useState } from "react";
import { Download } from "lucide-react";
import { useT } from "../../i18n";
import { StoreContext, useActions } from "../app-context";
import { Button } from "../kit";
import { errorMessage } from "../settings/diagnostics";
import { ImportTable, useImportCandidates } from "../settings/ImportTable";
import { ErrorText } from "../settings/SettingsCard";
import { WideDialog } from "../settings/WideDialog";
import { uiState } from "../ui-state";

/** First-run import: the Settings > Import table in a dialog, with Skip and Import selected. */
export function SessionImportDialog() {
  const t = useT();
  const actions = useActions();
  const state = useImportCandidates();
  const [busy, setBusy] = useState(false);
  const store = useContext(StoreContext);

  const finish = async (paths: string[] | null): Promise<void> => {
    setBusy(true);
    state.setError(null);
    try {
      // Say what happened: the sidebar can fill from other sources, so the outcome of this dialog is stated outright.
      let message: string;
      if (paths === null) {
        await actions.skipSessionImport();
        message = t("shell.import.doneSkipped");
      } else {
        const imported = await actions.importSessions(paths);
        message = t("shell.import.doneImported", { count: imported.length });
      }
      uiState.setSessionImportOpen(false);
      store?.dispatch({ type: "notice/pushed", notice: { id: crypto.randomUUID(), level: "info", message, threadId: null } });
    } catch (cause) {
      state.setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <WideDialog
      title={t("shell.import.title")}
      onClose={() => { if (!busy) void finish(null); }}
      description={
        <span className="flex flex-col gap-1">
          <span>{t("shell.import.hint")}</span>
          {state.emptyCount > 0 && <span className="text-xs" data-testid="session-import-empty-count">{t("shell.import.empty", { count: state.emptyCount })}</span>}
        </span>
      }
      footer={
        <>
          {state.cursor !== null && (
            <Button variant="ghost" className="mr-auto" disabled={state.loading || busy} data-testid="session-import-more" onClick={() => void state.load(state.cursor)}>
              {t("shell.import.more")}
            </Button>
          )}
          <Button variant="outline" disabled={busy} data-testid="session-import-skip" onClick={() => void finish(null)}>{t("shell.import.skip")}</Button>
          <Button icon={<Download aria-hidden="true" />} disabled={busy || state.loading || state.chosen.length === 0} data-testid="session-import-confirm" onClick={() => void finish(state.chosen)}>
            {t("shell.import.confirm", { count: state.chosen.length })}
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="session-import-dialog">
        {state.error !== null && <ErrorText>{state.error}</ErrorText>}
        {state.items.length > 0 && <ImportTable state={state} busy={busy} maxHeight="flex-1" />}
        {state.loading && <p className="m-0 text-sm text-muted-foreground" role="status">{t("shell.import.loading")}</p>}
        {!state.loading && state.items.length === 0 && state.error === null && (
          <p className="m-0 text-sm text-muted-foreground" data-testid="session-import-nothing">{t("shell.import.nothing")}</p>
        )}
      </div>
    </WideDialog>
  );
}
