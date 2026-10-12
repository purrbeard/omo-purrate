import { ShortcutKeys } from "@deepseek-ai/dsh-client-ui-primitives";
import { useT } from "../../i18n";
import { APP_SHORTCUTS, shortcutKeys } from "../shortcuts";
import { SectionHeading, SettingRow } from "./SectionHeading";
import css from "./SettingsDialog.module.css";

export function KeybindingsSection() {
  const t = useT();
  return (
    <section className={css.section} data-testid="settings-keybindings">
      <SectionHeading title={t("shell.settings.nav.keybindings")} intro={t("shell.settings.keybindings.intro")} />
      <div className={css.card}>
        {APP_SHORTCUTS.map((shortcut) => (
          <SettingRow key={shortcut.id} title={t(shortcut.label)}>
            <span data-shortcut={shortcut.id}>
              <ShortcutKeys keys={shortcutKeys(shortcut, window.omo.platform)} className={css.keycaps} />
            </span>
          </SettingRow>
        ))}
      </div>
    </section>
  );
}
