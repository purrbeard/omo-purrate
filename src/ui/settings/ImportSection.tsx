import { useState } from "react";
import { Download, HardDrive } from "lucide-react";
import { useT } from "../../i18n";
import { useActions } from "../app-context";
import { Badge, Button } from "../kit";
import { errorMessage } from "./diagnostics";
import { ImportTable, useImportCandidates } from "./ImportTable";
import { SectionHeading } from "./SectionHeading";
import { ErrorText, SettingsCard, SettingsRow, ui } from "./SettingsCard";

/**
 * Settings > Import: sync state first (off: imports are one-time and explicit), then one card per source
 * with its session table and an explicit import button.
 */
export function ImportSection() {
  const t = useT();
  const actions = useActions();
  const state = useImportCandidates();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  const importChosen = async (): Promise<void> => {
    setBusy(true);
    setDone(null);
    state.setError(null);
    try {
      const imported = await actions.importSessions(state.chosen);
      state.setMany(state.chosen, false);
      setDone(imported.length);
    } catch (cause) {
      state.setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={ui.section} data-testid="settings-import" aria-busy={state.loading || busy}>
      <SectionHeading title={t("shell.settings.nav.import")} intro={t("shell.settings.import.intro")} />
      <SettingsCard>
        <SettingsRow title={t("shell.settings.import.syncTitle")} description={t("shell.settings.import.syncHint")}>
          <Badge variant="outline" data-testid="settings-import-sync">{t("shell.settings.import.syncOff")}</Badge>
        </SettingsRow>
      </SettingsCard>
      <SettingsCard testId="settings-import-source" dataAttrs={{ "data-source": "omo" }}>
        <div className="flex flex-col gap-3 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-muted text-foreground" aria-hidden="true">
              <HardDrive className="size-4" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <h4 className={ui.heading}>{t("shell.settings.import.sourceTitle")}</h4>
              <p className="m-0 text-xs leading-4.5 text-muted-foreground">{t("shell.settings.import.sourceHint")}</p>
            </div>
            <Button size="sm" icon={<Download aria-hidden="true" />} disabled={busy || state.loading || state.chosen.length === 0}
              data-testid="settings-import-confirm" onClick={() => void importChosen()}>
              {t("shell.import.confirm", { count: state.chosen.length })}
            </Button>
          </div>
          <p className={ui.muted}>{t("shell.import.hint")}</p>
          {state.emptyCount > 0 && <p className="m-0 text-xs leading-4.5 text-muted-foreground">{t("shell.import.empty", { count: state.emptyCount })}</p>}
          {state.error !== null && <ErrorText>{state.error}</ErrorText>}
          {done !== null && <p className={ui.text} role="status" data-testid="settings-import-done">{t("shell.settings.import.done", { count: done })}</p>}
          {state.items.length > 0 && <ImportTable state={state} busy={busy} maxHeight="max-h-120" />}
          {state.loading && <p className={ui.muted} role="status">{t("shell.import.loading")}</p>}
          {!state.loading && state.items.length === 0 && state.error === null && <p className={ui.muted}>{t("shell.import.nothing")}</p>}
          {state.cursor !== null && (
            <Button variant="outline" size="sm" className="self-start" disabled={state.loading || busy} onClick={() => void state.load(state.cursor)}>
              {t("shell.import.more")}
            </Button>
          )}
        </div>
      </SettingsCard>
    </section>
  );
}
