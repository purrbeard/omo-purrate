import { useEffect, useState } from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ModelRoute, ModelRoutingInput, ModelRoutingSettings } from "../../../shared/model-routing";
import { useT } from "../../i18n";
import { selectIsTurnActive } from "../../state";
import { useAppSelector } from "../app-context";
import { SettingRow } from "./SectionHeading";
import css from "./SettingsDialog.module.css";
import routeCss from "./ModelRoutingSection.module.css";

const CATEGORIES = ["quick", "deep-low", "deep-high", "ultrabrain", "architect", "writing", "artistry", "visual-engineering", "unspecified-low", "unspecified-high"];
const AGENTS = ["explore", "librarian"];

export function ModelRoutingSection() {
  const t = useT();
  const models = useAppSelector((state) => state.models);
  const active = useAppSelector((state) => Object.keys(state.threads).some((id) => selectIsTurnActive(state, id)));
  const [settings, setSettings] = useState<ModelRoutingSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mappingName, setMappingName] = useState("");
  useEffect(() => {
    let live = true;
    void window.omo.readModelRouting().then((result) => {
      if (!live) return;
      const fill = (rows: ModelRoute[], names: string[]): ModelRoute[] => [...rows, ...names.filter((name) => !rows.some((row) => row.name === name)).map((name) => ({ name, models: [] }))];
      setSettings({ ...result, categories: fill(result.categories, CATEGORIES), agents: fill(result.agents, AGENTS) });
    }, (reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { live = false; };
  }, []);
  const update = (group: keyof ModelRoutingInput, name: string, value: string): void => {
    setSaved(false);
    setSettings((previous) => previous === null ? null : ({ ...previous, [group]: previous[group].map((row) => row.name === name ? { ...row, models: value.split(/\r?\n/).map((ref) => ref.trim()).filter(Boolean) } : row) }));
  };
  const save = async (): Promise<void> => {
    if (settings === null) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      await window.omo.saveModelRouting({ categories: settings.categories.filter((row) => row.models.length > 0), agents: settings.agents.filter((row) => row.models.length > 0), mappings: settings.mappings });
      setSaved(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  return <>
    <div className={`${css.card} ${css.wrapRows}`} data-testid="model-routing" aria-busy={saving || settings === null}>
      <div className={css.cardBody}><h3>{t("shell.settings.routing.title")}</h3><p className={css.muted}>{t("shell.settings.routing.hint")}</p>
        <datalist id="omo-routing-models">{models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</datalist>
      </div>
      {(["agents", "categories", "mappings"] as const).map((group) => <div key={group}>
        <div className={css.cardBody}><h4>{t(`shell.settings.routing.${group}`)}</h4></div>
        {settings?.[group].map((row) => <SettingRow key={row.name} title={row.name} hint={group === "mappings" ? t("shell.settings.routing.mappingHint") : t("shell.settings.routing.chainHint")}>
          {group === "mappings" ? <input className={routeCss.input} list="omo-routing-models" aria-label={row.name} data-route-group={group} data-route-name={row.name} disabled={saving} value={row.models.join("\n")} onChange={(event) => update(group, row.name, event.target.value)} /> : <textarea className={routeCss.input} rows={2} aria-label={row.name} data-route-group={group} data-route-name={row.name} disabled={saving} defaultValue={row.models.join("\n")} placeholder="provider/model:high" onBlur={(event) => update(group, row.name, event.target.value)} />}
        </SettingRow>)}
      </div>)}
      <div className={css.cardBody}>
        <label className={routeCss.newMapping}>{t("shell.settings.routing.name")}<input className={routeCss.input} value={mappingName} disabled={saving || settings === null} onChange={(event) => setMappingName(event.target.value)} data-testid="mapping-name" /></label>
        <Button variant="outline" disabled={saving || settings === null || !/^[A-Za-z0-9_.-]+$/.test(mappingName) || settings?.mappings.some((row) => row.name === mappingName)} onClick={() => { setSettings((previous) => previous === null ? null : ({ ...previous, mappings: [...previous.mappings, { name: mappingName, models: [] }] })); setMappingName(""); setSaved(false); }}>{t("shell.settings.routing.add")}</Button>
        <p className={css.muted}>{t("shell.settings.routing.saveHint")}</p>
        <Button variant="primary" data-testid="routing-save" disabled={saving || active || settings === null || settings.mappings.some((row) => row.models.length !== 1)} onClick={() => void save()}>{t(saving ? "shell.settings.routing.saving" : "shell.settings.routing.save")}</Button>
        {saved && <p role="status" data-testid="routing-saved">{t("shell.settings.routing.saved")}</p>}
        {settings && <p className={css.muted}><code>{settings.configPath}</code></p>}
      </div>
    </div>
    {error && <p className={css.error} role="alert">{error}</p>}
  </>;
}
