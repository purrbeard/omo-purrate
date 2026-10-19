import { useState, type CSSProperties } from "react";
import clsx from "clsx";
import { Check, RotateCcw } from "lucide-react";
import type { LocalePreference, PalettePreference, Preferences, ThemePreference } from "../../../shared/ipc";
import { useT } from "../../i18n";
import { Button, focusRing } from "../kit";
import { revealThemePreference } from "../theme";
import { TESTID } from "../testids";
import { updatePreferences, useUiState } from "../ui-state";
import { errorMessage } from "./diagnostics";
import { SectionHeading, SettingRow } from "./SectionHeading";
import { ErrorText, Segmented, SettingsCard, ui } from "./SettingsCard";

const schemes = ["system", "light", "dark"] as const;
/** Static swatches that picture each palette; Noir, the default, leads the list. */
const palettes: readonly { id: PalettePreference; name: string; light: string; dark: string; accent: string }[] = [
  { id: "noir", name: "Noir", light: "#ffffff", dark: "#0a0a0a", accent: "#e0323b" },
  { id: "omo", name: "OmO", light: "#f5f0fc", dark: "#181121", accent: "#6656d9" },
  { id: "classic", name: "Classic", light: "#faf3ef", dark: "#21171b", accent: "#996b51" },
  { id: "mint", name: "Mint", light: "#edf7f0", dark: "#14211a", accent: "#248567" },
  { id: "ocean", name: "Ocean", light: "#edf3fb", dark: "#111b2b", accent: "#3878d4" },
  { id: "sbd", name: "SBD", light: "#fff1f2", dark: "#100d0e", accent: "#d82f46" },
];
const schemeIds = { system: TESTID.settingsThemeSystem, light: TESTID.settingsThemeLight, dark: TESTID.settingsThemeDark };

const choiceClass = clsx(
  "group relative box-border m-0 flex min-w-0 cursor-pointer flex-col items-stretch gap-3 rounded-xl border-2 border-solid border-border bg-card p-3",
  "[font-family:inherit] text-sm font-medium text-foreground transition-colors duration-150 motion-reduce:transition-none",
  "hover:bg-accent aria-pressed:border-foreground",
  focusRing,
);

function Selected() {
  return (
    <span className="absolute top-2 right-2 hidden size-5 items-center justify-center rounded-full bg-foreground text-background group-aria-pressed:flex" aria-hidden="true">
      <Check className="size-3.5" strokeWidth={3} />
    </span>
  );
}

/** A miniature window (sidebar, lines, composer) painted with the preview colors. */
function MiniWindow({ scheme }: { scheme: ThemePreference }) {
  const surface = scheme === "dark" ? "bg-(--preview-dark)" : scheme === "light" ? "bg-(--preview-light)" : "bg-[linear-gradient(90deg,var(--preview-light)_50%,var(--preview-dark)_50%)]";
  return (
    <span className={clsx("box-border flex h-22 w-full gap-2 overflow-hidden rounded-lg border border-solid border-border p-2.5", surface)} aria-hidden="true">
      <span className="flex w-1/5 flex-col gap-1.5 rounded-sm bg-(--preview-accent)/10 p-1.5">
        <i className="block h-1.5 rounded-full bg-(--preview-accent)/25" />
        <i className="block h-1.5 rounded-full bg-(--preview-accent)/25" />
      </span>
      <span className="flex flex-1 flex-col gap-1.5 py-1">
        <i className="block h-1.5 w-1/2 rounded-full bg-(--preview-accent)/25" />
        <b className="relative mt-auto block h-3.5 rounded-sm bg-(--preview-accent)/15">
          <span className="absolute top-1 right-1 size-1.5 rounded-full bg-(--preview-accent)" />
        </b>
      </span>
    </span>
  );
}

export function AppearanceSection() {
  const t = useT();
  const { preferences } = useUiState();
  const [error, setError] = useState<string | null>(null);
  const save = (patch: Partial<Preferences>): void => {
    void updatePreferences(patch).then(() => setError(null), (reason: unknown) => setError(errorMessage(reason)));
  };
  const theme = preferences?.theme ?? "system";
  const palette = preferences?.palette ?? "noir";
  const swatch = palettes.find((item) => item.id === palette) ?? palettes[0]!;
  const preview = { "--preview-light": swatch.light, "--preview-dark": swatch.dark, "--preview-accent": swatch.accent } as CSSProperties;
  return (
    <section className={clsx(ui.section, "gap-4")}>
      <SectionHeading title={t("shell.settings.nav.appearance")} intro={t("shell.settings.appearance.intro")}>
        <Button variant="outline" size="sm" icon={<RotateCcw aria-hidden="true" />} data-testid="appearance-reset" onClick={() => save({ theme: "system", palette: "noir", locale: "system" })}>
          {t("shell.settings.appearance.reset")}
        </Button>
      </SectionHeading>
      <h3 className={clsx(ui.heading, "mt-1")}>{t("shell.settings.appearance.scheme")}</h3>
      <div className="grid grid-cols-3 gap-3" role="group" aria-label={t("shell.settings.appearance.scheme")} style={preview}>
        {schemes.map((scheme: ThemePreference) => (
          <button key={scheme} type="button" className={choiceClass} data-testid={schemeIds[scheme]} aria-pressed={theme === scheme}
            onClick={(event) => revealThemePreference(scheme, event.currentTarget, () => save({ theme: scheme }))}>
            <MiniWindow scheme={scheme} />
            <span className="text-center">{t(`shell.settings.theme.${scheme}`)}</span>
            <Selected />
          </button>
        ))}
      </div>
      <h3 className={clsx(ui.heading, "mt-2")}>{t("shell.settings.appearance.palettes")}</h3>
      <p className={clsx(ui.muted, "-mt-2")}>{t("shell.settings.appearance.paletteHint")}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="group" aria-label={t("shell.settings.appearance.palettes")}>
        {palettes.map((item) => (
          <button key={item.id} type="button" className={clsx(choiceClass, "items-center")} data-testid={`settings-palette-${item.id}`} aria-pressed={palette === item.id}
            style={{ "--preview-light": item.light, "--preview-dark": item.dark, "--preview-accent": item.accent } as CSSProperties} onClick={() => save({ palette: item.id })}>
            <span className="flex justify-center gap-1.5 py-1" aria-hidden="true">
              <span className="block h-11 w-7 rounded-full border-2 border-solid border-(--preview-accent) bg-(--preview-light)" />
              <span className="block h-11 w-7 rounded-full border-2 border-solid border-transparent bg-(--preview-dark)" />
            </span>
            <span className="max-w-full truncate">{item.id === "noir" ? t("shell.settings.appearance.noir") : item.name}</span>
            <Selected />
          </button>
        ))}
      </div>
      <SettingsCard className="mt-2">
        <SettingRow title={t("shell.settings.language")} hint={t("shell.settings.language.hint")}>
          <div data-testid={TESTID.settingsLanguage}>
            <Segmented<LocalePreference>
              label={t("shell.settings.language")}
              value={preferences?.locale ?? "system"}
              options={[{ value: "system", label: t("shell.settings.language.system") }, { value: "en", label: t("shell.settings.language.en") }, { value: "ko", label: t("shell.settings.language.ko") }]}
              onChange={(locale) => save({ locale })}
            />
          </div>
        </SettingRow>
      </SettingsCard>
      {error && <ErrorText>{t("shell.settings.saveFailed", { message: error })}</ErrorText>}
    </section>
  );
}
