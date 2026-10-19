import { useT } from "../../i18n";
import { APP_SHORTCUTS, shortcutKeys } from "../shortcuts";
import { ShortcutKeys } from "../kit";
import { SectionHeading, SettingRow } from "./SectionHeading";
import { SettingsCard, ui } from "./SettingsCard";

export function KeybindingsSection() {
  const t = useT();
  return (
    <section className={ui.section} data-testid="settings-keybindings">
      <SectionHeading title={t("shell.settings.nav.keybindings")} intro={t("shell.settings.keybindings.intro")} />
      <SettingsCard>
        {APP_SHORTCUTS.map((shortcut) => (
          <SettingRow key={shortcut.id} title={t(shortcut.label)}>
            <span data-shortcut={shortcut.id}>
              <ShortcutKeys keys={shortcutKeys(shortcut, window.omo.platform)} />
            </span>
          </SettingRow>
        ))}
      </SettingsCard>
    </section>
  );
}
