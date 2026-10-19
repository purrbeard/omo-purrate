import { useEffect, useState } from "react";
import { Button } from "../kit";
import type { ModelRoute, ModelRoutingInput, ModelRoutingSettings } from "../../../shared/model-routing";
import { useT } from "../../i18n";
import { selectIsTurnActive } from "../../state";
import { useAppSelector } from "../app-context";
import { SettingRow } from "./SectionHeading";
import { errorMessage } from "./diagnostics";
import { ErrorText, ui } from "./SettingsCard";

const fieldClass = `${ui.field} w-75 max-w-full resize-y px-2.5 py-1.5 text-sm leading-5`;
import { groupModels } from "../composer/model-groups";

const CATEGORIES = ["quick", "deep-low", "deep-high", "ultrabrain", "architect", "writing", "artistry", "visual-engineering", "unspecified-low", "unspecified-high"];
const AGENTS = ["explore", "librarian", "plan-consultant", "plan-reviewer", "omo-native-code-reviewer", "omo-native-gate-reviewer", "omo-native-qa-executor"];

export function ModelRoutingSection() {
  const t = useT();
  const models = useAppSelector((state) => state.models);
  const active = useAppSelector((state) => Object.keys(state.threads).some((id) => selectIsTurnActive(state, id)));
  const [settings, setSettings] = useState<ModelRoutingSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mappingName, setMappingName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const modelGroups = groupModels(models);
  useEffect(() => {
    let live = true;
    void window.omo.readModelRouting().then((result) => {
      if (!live) return;
      const fill = (rows: ModelRoute[], names: string[]): ModelRoute[] => [...rows, ...names.filter((name) => !rows.some((row) => row.name === name)).map((name) => ({ name, models: [] }))];
      setSettings({ ...result, categories: fill(result.categories, CATEGORIES), agents: fill(result.agents, AGENTS) });
    }, (reason: unknown) => { if (live) setError(errorMessage(reason)); });
    return () => { live = false; };
  }, []);
  const update = (group: keyof ModelRoutingInput, name: string, value: string): void => {
    setDrafts((previous) => ({ ...previous, [`${group}:${name}`]: value }));
    setSaved(false);
    setSettings((previous) => previous === null ? null : ({ ...previous, [group]: previous[group].map((row) => row.name === name ? { ...row, models: value.split(/\r?\n/).map((ref) => ref.trim()).filter(Boolean) } : row) }));
  };
  const save = async (): Promise<void> => {
    if (settings === null) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      await window.omo.saveModelRouting({ categories: settings.categories.filter((row) => row.models.length > 0 || drafts[`categories:${row.name}`] !== undefined), agents: settings.agents.filter((row) => row.models.length > 0 || drafts[`agents:${row.name}`] !== undefined), mappings: settings.mappings });
      setSaved(true);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setSaving(false); }
  };
  return <>
    <div className={ui.card} data-testid="model-routing" aria-busy={saving || settings === null}>
      <div className={ui.cardBody}><h3 className={ui.heading}>{t("shell.settings.routing.title")}</h3><p className={ui.muted}>{t("shell.settings.routing.hint")}</p>
        <datalist id="omo-routing-models">{models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</datalist>
      </div>
      {(["agents", "categories", "mappings"] as const).map((group) => <div key={group}>
        <div className="border-0 border-t border-solid border-border pt-4"><h4 className={ui.subheading}>{t(`shell.settings.routing.${group}`)}</h4></div>
        {settings?.[group].map((row) => <SettingRow key={row.name} title={row.name} hint={group === "mappings" ? t("shell.settings.routing.mappingHint") : t("shell.settings.routing.chainHint")}>
          <div className="flex max-w-full flex-col gap-2">
            <select className={fieldClass} aria-label={`${row.name}: ${t("shell.settings.routing.choose")}`} data-model-list-group={group} data-model-list-name={row.name} value="" disabled={saving || models.length === 0} onChange={(event) => {
              const selected = event.target.value;
              if (!selected) return;
              const current = drafts[`${group}:${row.name}`] ?? row.models.join("\n");
              const refs = current.split(/\r?\n/).map((ref) => ref.trim()).filter(Boolean);
              update(group, row.name, group === "mappings" ? selected : [...refs, ...(!refs.includes(selected) ? [selected] : [])].join("\n"));
            }}>
              <option value="">{t(models.length === 0 ? "composer.model.empty" : "shell.settings.routing.choose")}</option>
              {modelGroups.map((provider) => <optgroup key={provider.provider} label={provider.provider}>{provider.models.map((model) => <option key={model.id} value={model.id}>{model.displayName} · {model.id}</option>)}</optgroup>)}
            </select>
            {group !== "mappings" && row.models.map((ref, index) => <div key={`${index}:${ref}`} className="flex max-w-75 items-center gap-1 [&>code]:min-w-0 [&>code]:flex-1 [&>code]:truncate [&>code]:font-mono [&>code]:text-xs">
              <code>{ref}</code>
              <select className={`${ui.field} h-7 min-w-18 px-1 text-xs`} aria-label={`${row.name}: ${t("shell.settings.mapping.reasoning", { model: ref })}`} disabled={saving} value={ref.includes(":") ? ref.slice(ref.lastIndexOf(":") + 1) : ""} onChange={(event) => { const next = [...row.models]; const base = ref.includes(":") ? ref.slice(0, ref.lastIndexOf(":")) : ref; next[index] = event.target.value ? `${base}:${event.target.value}` : base; update(group, row.name, next.join("\n")); }}>
                <option value="">{t("shell.settings.mapping.reasoningDefault")}</option>
                {["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => <option key={level} value={level}>{level}</option>)}
              </select>
              <Button variant="outline" size="sm" disabled={saving || index === 0} aria-label={`${row.name}: ${t("shell.settings.mapping.up")} ${index + 1}`} onClick={() => { const next = [...row.models]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; update(group, row.name, next.join("\n")); }}>↑</Button>
              <Button variant="outline" size="sm" disabled={saving || index === row.models.length - 1} aria-label={`${row.name}: ${t("shell.settings.mapping.down")} ${index + 1}`} onClick={() => { const next = [...row.models]; [next[index + 1], next[index]] = [next[index]!, next[index + 1]!]; update(group, row.name, next.join("\n")); }}>↓</Button>
              <Button variant="outline" size="sm" disabled={saving} aria-label={t("shell.settings.mapping.remove", { model: ref })} onClick={() => update(group, row.name, row.models.filter((_, i) => i !== index).join("\n"))}>×</Button>
            </div>)}
            {group === "mappings" ? <input className={fieldClass} list="omo-routing-models" aria-label={row.name} data-route-group={group} data-route-name={row.name} disabled={saving} value={drafts[`${group}:${row.name}`] ?? row.models.join("\n")} onChange={(event) => update(group, row.name, event.target.value)} /> : <textarea className={fieldClass} rows={2} aria-label={row.name} data-route-group={group} data-route-name={row.name} disabled={saving} value={drafts[`${group}:${row.name}`] ?? row.models.join("\n")} placeholder="provider/model:high" onChange={(event) => update(group, row.name, event.target.value)} />}
            {group === "mappings" && <Button variant="outline" size="sm" disabled={saving} data-route-remove={row.name} aria-label={t("shell.settings.mapping.remove", { model: row.name })} onClick={() => {
              setSettings((previous) => previous === null ? null : ({ ...previous, mappings: previous.mappings.filter((mapping) => mapping.name !== row.name) }));
              setDrafts((previous) => { const next = { ...previous }; delete next[`mappings:${row.name}`]; return next; });
              setSaved(false);
            }}>×</Button>}
          </div>
        </SettingRow>)}
      </div>)}
      <div className={`${ui.cardBody} border-0 border-t border-solid border-border`}>
        <label className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">{t("shell.settings.routing.name")}<input className={fieldClass} value={mappingName} disabled={saving || settings === null} onChange={(event) => setMappingName(event.target.value)} data-testid="mapping-name" /></label>
        <Button variant="outline" disabled={saving || settings === null || !/^[A-Za-z0-9_.-]+$/.test(mappingName) || settings?.mappings.some((row) => row.name === mappingName)} onClick={() => { setSettings((previous) => previous === null ? null : ({ ...previous, mappings: [...previous.mappings, { name: mappingName, models: [] }] })); setMappingName(""); setSaved(false); }}>{t("shell.settings.routing.add")}</Button>
        <p className={ui.muted}>{t("shell.settings.routing.saveHint")}</p>
        <Button variant="primary" data-testid="routing-save" disabled={saving || active || settings === null || settings.mappings.some((row) => row.models.length !== 1)} onClick={() => void save()}>{t(saving ? "shell.settings.routing.saving" : "shell.settings.routing.save")}</Button>
        {saved && <p className={ui.muted} role="status" data-testid="routing-saved">{t("shell.settings.routing.saved")}</p>}
        {settings && <p className={ui.muted}><code className={ui.mono}>{settings.configPath}</code></p>}
      </div>
    </div>
    {error && <ErrorText>{error}</ErrorText>}
  </>;
}
