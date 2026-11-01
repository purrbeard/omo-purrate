import { useState } from "react";
import type { CodexRolloutPreview, CodexUnsupportedReason } from "../../../shared/codex-import";
import { useT, type MessageKey } from "../../i18n";
import { useActions, useAppSelector } from "../app-context";
import { groupModels } from "../composer/model-groups";
import { Button, Input } from "../kit";
import { uiState } from "../ui-state";
import { errorMessage } from "./diagnostics";
import { ErrorText, SettingsCard, SettingsRow, ui } from "./SettingsCard";

const reasons: Record<CodexUnsupportedReason, MessageKey> = {
  encrypted_reasoning: "shell.settings.import.codexEncrypted",
  source_instructions: "shell.settings.import.codexInstructions",
  source_accounting: "shell.settings.import.codexAccounting",
  runtime_state: "shell.settings.import.codexRuntime",
  duplicate_event: "shell.settings.import.codexDuplicate",
  external_image: "shell.settings.import.codexImage",
  unsupported_event: "shell.settings.import.codexUnknown",
  unsupported_record: "shell.settings.import.codexUnknown",
  unsupported_content: "shell.settings.import.codexUnknown",
  missing_model: "shell.settings.import.codexMissingModel",
  unmatched_tool_call: "shell.settings.import.codexUnmatchedCall",
};

/** Selection previews a read-only source; only explicit confirmation creates a native copy. */
export function CodexImport() {
  const t = useT();
  const actions = useActions();
  const models = useAppSelector(state => state.models);
  const [preview, setPreview] = useState<CodexRolloutPreview | null>(null);
  const [cwd, setCwd] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const pick = async (): Promise<void> => {
    setBusy(true); setError(null); setDone(null); setPreview(null);
    try {
      const selected = await window.omo.pickCodexRollout();
      if (selected !== null) { setPreview(selected); setCwd(selected.cwd ?? ""); setModel(""); }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  const confirm = async (): Promise<void> => {
    if (preview === null) return;
    setBusy(true); setError(null); setDone(null);
    try {
      const result = await window.omo.importCodexRollout({ fingerprint: preview.fingerprint, cwd, model });
      uiState.setPreferences(await window.omo.getPreferences());
      await actions.refreshThreads();
      setDone(result.path); setPreview(null);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  return <SettingsCard testId="codex-import" aria-busy={busy}>
    <SettingsRow title={t("shell.settings.import.codexTitle")} description={t("shell.settings.import.codexHint")}>
      <Button variant="outline" size="sm" disabled={busy} data-testid="codex-import-pick" onClick={() => void pick()}>{t("shell.settings.import.codexPick")}</Button>
    </SettingsRow>
    {preview !== null && <div className="flex min-w-0 flex-col gap-4 pb-4" data-testid="codex-import-preview">
      <dl className={ui.facts}>
        <dt>{t("shell.settings.import.codexSource")}</dt><dd>{preview.sourcePath}</dd>
        <dt>{t("shell.settings.import.codexModel")}</dt><dd>{preview.provider ?? "-"} / {preview.model ?? "-"}</dd>
        <dt>{t("shell.settings.import.codexCounts")}</dt><dd>{t("shell.settings.import.codexCountValues", { users: preview.converted.userMessages, assistants: preview.converted.assistantMessages, calls: preview.converted.toolCalls, results: preview.converted.toolResults, images: preview.converted.images })}</dd>
      </dl>
      <div className="flex flex-col gap-2">
        <h4 className={ui.heading}>{t("shell.settings.import.codexLosses")}</h4>
        {preview.unsupported.length === 0 ? <p className={ui.muted}>{t("shell.settings.import.codexNoLosses")}</p> :
          <ul className="m-0 flex flex-col gap-1 pl-5 text-sm leading-5 text-muted-foreground">
            {preview.unsupported.map(item => <li key={item.reason} data-reason={item.reason} data-count={item.count}>{t(reasons[item.reason])}: <span className="tabular-nums">{item.count}</span></li>)}
          </ul>}
      </div>
      <label className="flex min-w-0 flex-col gap-2 text-sm text-foreground">
        {t("shell.settings.import.codexCwd")}
        <Input value={cwd} disabled={busy} data-testid="codex-import-cwd" onChange={event => setCwd(event.target.value)} />
      </label>
      <label className="flex min-w-0 flex-col gap-2 text-sm text-foreground">
        {t("shell.settings.import.codexContinueModel")}
        <select className={`${ui.control} w-full min-w-0`} value={model} disabled={busy} data-testid="codex-import-model" onChange={event => setModel(event.target.value)}>
          <option value="">{t("shell.settings.import.codexChooseModel")}</option>
          {groupModels(models.filter(item => !item.hidden)).map(group => <optgroup key={group.provider} label={group.provider}>
            {group.models.map(item => <option key={item.id} value={item.id}>{item.displayName} · {item.id}</option>)}
          </optgroup>)}
        </select>
      </label>
      <Button className="self-start" disabled={busy || cwd.trim() === "" || !models.some(item => item.id === model && !item.hidden)} data-testid="codex-import-confirm" onClick={() => void confirm()}>{t("shell.settings.import.codexConfirm")}</Button>
    </div>}
    {error !== null && <ErrorText className="pb-4" data-testid="codex-import-error">{error}</ErrorText>}
    {done !== null && <div className="flex min-w-0 flex-col gap-1 pb-4" role="status" data-testid="codex-import-done"><p className={ui.text}>{t("shell.settings.import.codexDone")}</p><p className={`${ui.muted} wrap-anywhere`}>{done}</p></div>}
  </SettingsCard>;
}
