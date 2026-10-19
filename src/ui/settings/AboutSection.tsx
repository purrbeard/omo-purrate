import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useT } from "../../i18n";
import { errorMessage, useDiagnostics } from "./diagnostics";
import { SectionHeading } from "./SectionHeading";
import { ErrorText, SettingsCard, ui } from "./SettingsCard";
import { AppUpdateSection } from "./AppUpdateSection";
import { uiState } from "../ui-state";
import { TESTID } from "../testids";

const DSH_REPOSITORY_URL = "https://github.com/deepseek-ai/deepseek-harness";

export function AboutSection() {
  const t = useT();
  const diagnostics = useDiagnostics();
  const [openError, setOpenError] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const pending = diagnostics.kind === "failed" ? t("shell.settings.omo.loadFailed", { message: diagnostics.message }) : t("shell.settings.omo.loading");
  const versions = diagnostics.kind === "ready" ? diagnostics.value : null;

  const openRepository = (): void => {
    window.omo.openExternal(DSH_REPOSITORY_URL).then(
      () => setOpenError(null),
      (error: unknown) => setOpenError(errorMessage(error)),
    );
  };

  const openLogs = (): void => {
    window.omo.openLogsFolder().then(
      () => setLogsError(null),
      (error: unknown) => setLogsError(errorMessage(error)),
    );
  };

  return (
    <section className={ui.section}>
      <SectionHeading title={t("shell.settings.nav.about")} intro={t("shell.settings.about.intro")} />
      <AppUpdateSection />
      <SettingsCard>
        <div className={ui.cardBody}>
          <button className={ui.link} type="button" data-testid="settings-show-onboarding" onClick={() => { uiState.setOnboardingOpen(true); }}>{t("shell.settings.about.showOnboarding")}</button>
          <button className={ui.link} type="button" data-testid={TESTID.settingsOpenLogs} onClick={openLogs}>{t("shell.settings.about.openLogs")}</button>
        </div>
      </SettingsCard>
      <SettingsCard>
        <div className={ui.cardBody}>
          <dl className={ui.facts}>
            <dt>{t("shell.settings.about.appVersion")}</dt>
            <dd className={versions === null ? undefined : ui.mono}>{versions?.appVersion ?? pending}</dd>
            <dt>{t("shell.settings.about.electronVersion")}</dt>
            <dd className={versions === null ? undefined : ui.mono}>{versions?.electronVersion ?? pending}</dd>
          </dl>
        </div>
      </SettingsCard>
      <SettingsCard>
        <div className={ui.cardBody}>
          <p className={ui.text}>{t("shell.settings.about.derived")}</p>
          <a
            className={ui.link}
            href={DSH_REPOSITORY_URL}
            onClick={(event) => {
              event.preventDefault();
              openRepository();
            }}
          >
            {t("shell.settings.about.repository")}
            <ArrowUpRight aria-hidden="true" />
          </a>
        </div>
      </SettingsCard>
      {logsError !== null && (
        <ErrorText>{t("shell.settings.about.openLogsFailed", { message: logsError })}</ErrorText>
      )}
      {openError !== null && (
        <ErrorText>{t("shell.settings.about.openFailed", { message: openError })}</ErrorText>
      )}
    </section>
  );
}
