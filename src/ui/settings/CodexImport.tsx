import { useEffect, useState } from "react";
import clsx from "clsx";
import type { CodexRolloutPreview, CodexSessionList, CodexSessionSummary, CodexUnsupportedReason } from "../../../shared/codex-import";
import { useT, type MessageKey } from "../../i18n";
import { useActions, useAppSelector } from "../app-context";
import { groupModels } from "../composer/model-groups";
import { Button, Input } from "../kit";
import { uiState } from "../ui-state";
import { errorMessage } from "./diagnostics";
import { cellClass, pathCellClass, rowClass, SessionTable, useUpdatedFormat } from "./ImportTable";
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
  const [found, setFound] = useState<CodexSessionList | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const updated = useUpdatedFormat();

  const loadFound = async (): Promise<void> => {
    try { setFound(await window.omo.listCodexSessions()); }
    catch (cause) { setError(errorMessage(cause)); }
  };
  useEffect(() => { void loadFound(); }, []);

  const choose = async (item: CodexSessionSummary): Promise<void> => {
    setBusy(true); setError(null); setDone(null); setPreview(null); setChosen(item.sourcePath);
    try {
      const selected = await window.omo.previewCodexSession(item.sourcePath);
      setPreview(selected); setCwd(item.cwd ?? selected.cwd ?? ""); setModel("");
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  const label = (item: CodexSessionSummary): string => {
    const name = item.title ?? updated(item.startedAt !== null && Number.isFinite(Date.parse(item.startedAt)) ? Date.parse(item.startedAt) : item.updatedAtMs);
    return item.project === null ? name : `${item.project} - ${name}`;
  };

  const pick = async (): Promise<void> => {
    setChosen(null);
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
      await loadFound();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  return <SettingsCard testId="codex-import" aria-busy={busy}>
    <SettingsRow title={t("shell.settings.import.codexTitle")} description={t("shell.settings.import.codexHint")}>
      <Button variant="outline" size="sm" disabled={busy} data-testid="codex-import-pick" onClick={() => void pick()}>{t("shell.settings.import.codexPick")}</Button>
    </SettingsRow>
    <div className="flex min-w-0 flex-col gap-2 pb-4" data-testid="codex-session-list">
      {found === null ? <p className={ui.muted} role="status">{t("shell.settings.import.codexListLoading")}</p>
        : found.items.length === 0 ? <p className={ui.muted}>{t("shell.settings.import.codexListEmpty", { root: found.root })}</p>
        : <>
          <p className={`${ui.muted} wrap-anywhere`}>{t("shell.settings.import.codexListRoot", { root: found.root })}</p>
          <SessionTable maxHeight="max-h-80" columns={["", "w-[28%]", "w-36", "w-24"]} head={<tr>
            <th scope="col" />
            <th scope="col">{t("shell.import.col.title")}</th>
            <th scope="col">{t("shell.import.col.path")}</th>
            <th scope="col">{t("shell.import.col.updated")}</th>
            <th scope="col">{t("shell.settings.import.codexColStatus")}</th>
          </tr>}>
            <tbody>
              {found.items.map(item => {
                const id = `codex-session-${item.sourcePath}`;
                const text = label(item);
                return <tr key={item.sourcePath} className={clsx(rowClass, "cursor-pointer", item.imported && "text-muted-foreground")}
                  data-testid="codex-session-row" data-source-id={item.sourceId ?? ""} data-imported={String(item.imported)} onClick={() => { if (!busy) void choose(item); }}>
                  <td className="text-center">
                    <input id={id} type="radio" name="codex-session" className="m-0 size-4 cursor-pointer accent-foreground" disabled={busy}
                      checked={chosen === item.sourcePath} onChange={() => void choose(item)} onClick={event => event.stopPropagation()} />
                  </td>
                  <td className={cellClass}><label htmlFor={id} className="cursor-pointer font-medium" title={text} data-testid="codex-session-title" onClick={event => event.stopPropagation()}>{text}</label></td>
                  <td className={pathCellClass} title={item.cwd ?? undefined}><bdi dir="ltr">{item.cwd ?? "-"}</bdi></td>
                  <td className="truncate text-xs text-muted-foreground tabular-nums">{updated(item.updatedAtMs)}</td>
                  <td className={clsx(cellClass, "text-xs")}>{item.imported ? t("shell.settings.import.codexImported") : ""}</td>
                </tr>;
              })}
            </tbody>
          </SessionTable>
          {found.omitted > 0 && <p className={ui.muted}>{t("shell.settings.import.codexListOmitted", { count: found.omitted })}</p>}
        </>}
    </div>
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
