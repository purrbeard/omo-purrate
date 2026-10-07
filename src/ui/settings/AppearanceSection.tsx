import { useState, type CSSProperties } from "react";
import { SegmentedControl } from "@deepseek-ai/dsh-client-ui-primitives";
import type { LocalePreference, PalettePreference, Preferences, ThemePreference } from "../../../shared/ipc";
import { useT } from "../../i18n";
import { revealThemePreference } from "../theme";
import { TESTID } from "../testids";
import { updatePreferences, useUiState } from "../ui-state";
import { errorMessage } from "./diagnostics";
import { SectionHeading, SettingRow } from "./SectionHeading";
import css from "./AppearanceSection.module.css";
import settings from "./SettingsDialog.module.css";

const schemes = ["system", "light", "dark"] as const;
const palettes: readonly { id: PalettePreference; name: string; light: string; dark: string; accent: string }[] = [
  { id: "omo", name: "OmO", light: "#f5f0fc", dark: "#181121", accent: "#6656d9" },
  { id: "classic", name: "Classic", light: "#faf3ef", dark: "#21171b", accent: "#996b51" },
  { id: "mint", name: "Mint", light: "#edf7f0", dark: "#14211a", accent: "#248567" },
  { id: "ocean", name: "Ocean", light: "#edf3fb", dark: "#111b2b", accent: "#3878d4" },
  { id: "sbd", name: "SBD", light: "#fff1f2", dark: "#100d0e", accent: "#d82f46" },
];
const schemeIds = { system: TESTID.settingsThemeSystem, light: TESTID.settingsThemeLight, dark: TESTID.settingsThemeDark };

export function AppearanceSection() {
  const t = useT();
  const { preferences } = useUiState();
  const [error, setError] = useState<string | null>(null);
  const save = (patch: Partial<Preferences>): void => {
    void updatePreferences(patch).then(() => setError(null), (reason: unknown) => setError(errorMessage(reason)));
  };
  const theme = preferences?.theme ?? "system";
  const palette = preferences?.palette ?? "omo";
  const swatch = palettes.find((item) => item.id === palette) ?? { light: "#f5f0fc", dark: "#181121", accent: "#6656d9" };
  const preview = { "--preview-light": swatch.light, "--preview-dark": swatch.dark, "--preview-accent": swatch.accent } as CSSProperties;
  return <section className={`${settings.section} ${css.page}`}>
    <div className={css.heading}>
      <SectionHeading title={t("shell.settings.nav.appearance")} intro={t("shell.settings.appearance.intro")} />
      <button className={css.reset} data-testid="appearance-reset" onClick={() => save({ theme: "system", palette: "omo", locale: "system" })}>{t("shell.settings.appearance.reset")}</button>
    </div>
    <h3 className={css.title}>{t("shell.settings.appearance.scheme")}</h3>
    <div className={css.schemes} role="group" aria-label={t("shell.settings.appearance.scheme")} style={preview}>
      {schemes.map((scheme: ThemePreference) => <button key={scheme} className={css.choice} data-testid={schemeIds[scheme]} aria-pressed={theme === scheme}
        onClick={(event) => revealThemePreference(scheme, event.currentTarget, () => save({ theme: scheme }))}>
        <span className={css.preview} data-scheme={scheme} aria-hidden="true"><span className={css.miniSide}><i /><i /></span><span className={css.miniMain}><i /><b /></span></span>
        <span>{t(`shell.settings.theme.${scheme}`)}</span>
      </button>)}
    </div>
    <h3 className={css.title}>{t("shell.settings.appearance.palettes")}</h3>
    <p className={css.hint}>{t("shell.settings.appearance.paletteHint")}</p>
    <div className={css.palettes} role="group" aria-label={t("shell.settings.appearance.palettes")}>
      {palettes.map((item) => <button key={item.id} className={css.choice} data-testid={`settings-palette-${item.id}`} aria-pressed={palette === item.id}
        style={{ "--preview-light": item.light, "--preview-dark": item.dark, "--preview-accent": item.accent } as CSSProperties} onClick={() => save({ palette: item.id })}>
        <span className={css.swatches} aria-hidden="true"><span /><span /></span><span>{item.name}</span>
      </button>)}
    </div>
    <div className={settings.card}><SettingRow title={t("shell.settings.language")} hint={t("shell.settings.language.hint")}>
      <div data-testid={TESTID.settingsLanguage}><SegmentedControl<LocalePreference> id="appearance-language" label={t("shell.settings.language")} value={preferences?.locale ?? "system"}
        options={[{ value: "system", label: t("shell.settings.language.system") }, { value: "en", label: t("shell.settings.language.en") }, { value: "ko", label: t("shell.settings.language.ko") }]}
        onChange={(locale) => save({ locale })} /></div>
    </SettingRow></div>
    {error && <p className={settings.error} role="alert">{t("shell.settings.saveFailed", { message: error })}</p>}
  </section>;
}
