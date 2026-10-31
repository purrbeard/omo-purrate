import { useState } from "react";
import { useT } from "../../i18n";
import { APP_SHORTCUTS, EDITABLE_SHORTCUTS, shortcutKeys, shortcutOverridesError, type ShortcutOverrides } from "../shortcuts";
import { Button, ShortcutKeys } from "../kit";
import { updatePreferences, useUiState } from "../ui-state";
import { errorMessage } from "./diagnostics";
import { SectionHeading, SettingRow } from "./SectionHeading";
import { ErrorText, SettingsCard, ui } from "./SettingsCard";

export function KeybindingsSection() {
  const t = useT();
  const { preferences } = useUiState();
  const [draft, setDraft] = useState<ShortcutOverrides | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const bindings = draft ?? preferences?.keyboardShortcuts ?? {};
  const validation = shortcutOverridesError(bindings);
  const error = validation === null ? failure : t(`shell.settings.keybindings.${validation}`);
  const save = async (next: ShortcutOverrides): Promise<void> => {
    setSaving(true);
    setFailure(null);
    try {
      await updatePreferences({ keyboardShortcuts: next });
      setDraft(null);
    } catch (reason) { setFailure(errorMessage(reason)); }
    finally { setSaving(false); }
  };
  return (
    <section className={ui.section} data-testid="settings-keybindings" data-dirty={draft !== null}>
      <SectionHeading title={t("shell.settings.nav.keybindings")} intro={t("shell.settings.keybindings.intro")} />
      <SettingsCard>
        {APP_SHORTCUTS.map((shortcut) => (
          <SettingRow key={shortcut.id} title={t(shortcut.label)}>
            <div className="flex max-w-full flex-wrap items-center gap-2">
              {EDITABLE_SHORTCUTS.has(shortcut.id) && (
                <input className={`${ui.control} w-48 max-w-full min-w-0`} aria-label={t(shortcut.label)}
                  aria-invalid={validation !== null} data-shortcut-input={shortcut.id} disabled={saving || preferences === null}
                  value={bindings[shortcut.id] ?? shortcut.keys.other.join("+").replace(/^Ctrl/, "CmdOrCtrl")}
                  onChange={event => { setDraft({ ...bindings, [shortcut.id]: event.target.value }); setFailure(null); }} />
              )}
              <span data-shortcut={shortcut.id}><ShortcutKeys keys={shortcutKeys(shortcut, window.omo.platform, bindings)} /></span>
            </div>
          </SettingRow>
        ))}
      </SettingsCard>
      {error !== null && <ErrorText data-testid="shortcuts-error">{error}</ErrorText>}
      <div className="flex flex-wrap gap-2">
        <Button data-testid="shortcuts-save" disabled={saving || preferences === null || draft === null || validation !== null}
          onClick={() => void save(bindings)}>{t("shell.settings.keybindings.save")}</Button>
        <Button variant="outline" data-testid="shortcuts-reset" disabled={saving || preferences === null}
          onClick={() => void save({})}>{t("shell.settings.keybindings.reset")}</Button>
      </div>
    </section>
  );
}
