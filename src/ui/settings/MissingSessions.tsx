import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { useT } from "../../i18n";
import { threadTitle } from "../conversation/format";
import { useActions, useAppSelector } from "../app-context";
import { Button } from "../kit";
import { TESTID } from "../testids";
import { useUiState } from "../ui-state";
import { errorMessage } from "./diagnostics";
import { ErrorText, SettingsCard, ui } from "./SettingsCard";

/**
 * Managed sessions whose session file is gone. Listed on demand and removed only by the button: the agent directory
 * can differ temporarily, so nothing is pruned automatically, and session files are never touched.
 */
export function MissingSessions() {
  const t = useT();
  const actions = useActions();
  const { preferences } = useUiState();
  const threads = useAppSelector((state) => state.threads);
  const managed = preferences?.managedThreadIds;
  const [missing, setMissing] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useMemo(() => (managed ?? []).join(","), [managed]);

  useEffect(() => {
    if (key === "") { setMissing([]); return; }
    let current = true;
    actions.inspectSessions(key.split(",")).then(
      (inspection) => { if (current) setMissing(inspection.missing); },
      (cause: unknown) => { if (current) setError(errorMessage(cause)); },
    );
    return () => { current = false; };
  }, [actions, key]);

  if (missing.length === 0 && error === null) return null;

  const remove = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await actions.removeMissingSessions([...missing]);
      setMissing([]);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard testId={TESTID.settingsImportMissing}>
      <div className="flex flex-col gap-2 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h4 className={`${ui.heading} min-w-0 flex-1`}>{t("shell.settings.import.missing", { count: missing.length })}</h4>
          <Button size="sm" variant="outline" icon={<Trash2 aria-hidden="true" />} disabled={busy || missing.length === 0}
            data-testid={TESTID.settingsImportMissingRemove} onClick={() => void remove()}>
            {t("shell.settings.import.missingRemove")}
          </Button>
        </div>
        <p className={ui.muted}>{t("shell.settings.import.missingHint")}</p>
        {error !== null && <ErrorText>{error}</ErrorText>}
        <ul className="m-0 max-h-40 list-none overflow-y-auto p-0 text-xs leading-5 text-muted-foreground">
          {missing.map((id) => {
            const known = threads[id];
            return <li key={id} className="truncate font-mono" title={id}>{known === undefined ? id : `${threadTitle(known, id)} · ${id}`}</li>;
          })}
        </ul>
      </div>
    </SettingsCard>
  );
}
