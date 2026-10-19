import { Fragment, useState } from "react";
import clsx from "clsx";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "../kit";
import { getOmoInstallCommand } from "../../../shared/ipc";
import type { Diagnostics } from "../../../shared/ipc";
import { useT } from "../../i18n";
import { useAppSelector } from "../../state/store";
import { InstallStatus } from "../onboarding/InstallStatus";
import { useInstaller } from "../onboarding/install";
import { TESTID } from "../testids";
import { updatePreferences, useUiState } from "../ui-state";
import { errorMessage, useDiagnostics } from "./diagnostics";
import { SectionHeading, SettingRow } from "./SectionHeading";
import { ErrorText, SettingsCard, ui } from "./SettingsCard";
import { ProxySection } from "./ProxySection";

type RestartState = { kind: "idle" } | { kind: "running" } | { kind: "failed"; message: string };

function PathValue({ value }: { value: string }) {
  const separator = window.omo.platform === "win32" ? ";" : ":";
  const entries = value.split(separator);
  return (
    <pre className={ui.codeBlock}>
      {entries.map((entry, index) => (
        <Fragment key={index}>
          {entry}
          {index < entries.length - 1 && (
            <>
              {separator}<wbr />
            </>
          )}
        </Fragment>
      ))}
    </pre>
  );
}

function DiagnosticsFacts({ value }: { value: Diagnostics }) {
  const t = useT();
  const { omo } = value;
  const notFound = t("shell.settings.omo.notFound");
  return (
    <>
      <dl className={ui.facts}>
        <dt>{t("shell.settings.omo.binary")}</dt>
        <dd className={omo === null ? undefined : ui.mono}>{omo?.path ?? notFound}</dd>
        <dt>{t("shell.settings.omo.version")}</dt>
        <dd className={omo === null ? undefined : ui.mono}>{omo?.version ?? notFound}</dd>
        <dt>{t("shell.settings.omo.source")}</dt>
        <dd>{omo === null ? notFound : t(`shell.settings.omo.source.${omo.source}`)}</dd>
        <dt>{t("shell.settings.omo.pid")}</dt>
        <dd className={value.childPid === null ? undefined : ui.mono}>
          {value.childPid ?? t("shell.settings.omo.notRunning")}
        </dd>
        <dt>{t("shell.settings.omo.loginEnv")}</dt>
        <dd>{value.loginShellEnv ? t("shell.settings.omo.loginEnv.yes") : t("shell.settings.omo.loginEnv.no")}</dd>
      </dl>
      <div className="flex flex-col gap-1.5 border-0 border-t border-solid border-border pt-3.5">
        <div className="text-sm leading-5 text-muted-foreground">{t("shell.settings.omo.path")}</div>
        {value.childPath === null ? (
          <p className={ui.muted}>{t("shell.settings.omo.notRunning")}</p>
        ) : (
          <PathValue value={value.childPath} />
        )}
      </div>
    </>
  );
}

export function OmoSection() {
  const t = useT();
  const diagnostics = useDiagnostics();
  const installer = useInstaller();
  const update = useAppSelector((state) => state.bridge?.update);
  const transport = useAppSelector((state) => (state.bridge?.state === "connected" ? state.bridge.transport : undefined));
  const hostNotice = useAppSelector((state) => (state.bridge?.state === "connected" ? state.bridge.hostNotice ?? null : null));
  const { preferences } = useUiState();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [restart, setRestart] = useState<RestartState>({ kind: "idle" });
  const installing = installer.phase.kind === "running";
  const updating = update?.state === "checking" || update?.state === "installing";
  const toggleUpdate = (): void => {
    setSaving(true);
    setSaveError(null);
    updatePreferences({ omoAutoUpdate: preferences?.omoAutoUpdate === false }).then(
      () => setSaving(false),
      (error: unknown) => { setSaving(false); setSaveError(errorMessage(error)); },
    );
  };

  const toggleSharedHost = (): void => {
    setSaving(true);
    setSaveError(null);
    updatePreferences({ sharedHost: preferences?.sharedHost !== true }).then(
      () => { setSaving(false); runRestart(); },
      (error: unknown) => { setSaving(false); setSaveError(errorMessage(error)); },
    );
  };

  const runRestart = (): void => {
    setRestart({ kind: "running" });
    window.omo.restart().then(
      () => setRestart({ kind: "idle" }),
      (error: unknown) => setRestart({ kind: "failed", message: errorMessage(error) }),
    );
  };

  return (
    <section className={ui.section}>
      <SectionHeading title={t("shell.settings.nav.omo")} intro={t("shell.settings.omo.intro")} />
      <ProxySection />
      <div className={ui.card}>
        <SettingRow title={t("shell.settings.omo.autoUpdate")} hint={t("shell.settings.omo.autoUpdateHint")}>
          <Button
            variant="outline"
            size="sm"
            data-testid={TESTID.omoAutoUpdate}
            aria-label={t("shell.settings.omo.autoUpdate")}
            aria-pressed={preferences?.omoAutoUpdate !== false}
            disabled={saving || preferences === null}
            onClick={toggleUpdate}
          >
            {t(preferences?.omoAutoUpdate === false ? "shell.settings.omo.autoUpdateOff" : "shell.settings.omo.autoUpdateOn")}
          </Button>
        </SettingRow>
        {update && (
          <p className={update.state === "failed" ? "m-0 pb-4 text-sm leading-5 text-destructive-foreground" : ui.cardFooter} role="status"
            data-testid={TESTID.omoUpdateStatus} data-state={update.state}>
            {update.state === "updated"
              ? t("shell.settings.omo.update.updated", { from: update.from, to: update.to })
              : update.state === "failed"
                ? t("shell.settings.omo.update.failed", { message: update.message })
                : t(`shell.settings.omo.update.${update.state}`)}
          </p>
        )}
        <SettingRow title={t("shell.settings.omo.sharedHost")} hint={t("shell.settings.omo.sharedHostHint")}>
          <Button
            variant="outline"
            size="sm"
            data-testid={TESTID.omoSharedHost}
            aria-label={t("shell.settings.omo.sharedHost")}
            aria-pressed={preferences?.sharedHost === true}
            disabled={saving || preferences === null || restart.kind === "running"}
            onClick={toggleSharedHost}
          >
            {t(preferences?.sharedHost === true ? "shell.settings.omo.sharedHostOn" : "shell.settings.omo.sharedHostOff")}
          </Button>
        </SettingRow>
        {transport !== undefined && (
          <p className={ui.cardFooter} role="status" data-testid={TESTID.omoHostTransport} data-transport={transport}>
            {t(`shell.settings.omo.transport.${transport}`)}
          </p>
        )}
        {hostNotice !== null && (
          <ErrorText className="pb-4" data-testid={TESTID.omoHostNotice}>{t("shell.settings.omo.hostNotice", { message: hostNotice })}</ErrorText>
        )}
        {saveError !== null && <ErrorText className="pb-4">{t("shell.settings.saveFailed", { message: saveError })}</ErrorText>}
      </div>
      <SettingsCard testId={TESTID.diagnostics} aria-busy={diagnostics.kind === "loading"}>
        <div className={ui.cardBody}>
          {diagnostics.kind === "loading" && <p className={ui.muted}>{t("shell.settings.omo.loading")}</p>}
          {diagnostics.kind === "failed" && (
            <ErrorText>{t("shell.settings.omo.loadFailed", { message: diagnostics.message })}</ErrorText>
          )}
          {diagnostics.kind === "ready" && <DiagnosticsFacts value={diagnostics.value} />}
        </div>
      </SettingsCard>
      <div className={ui.card}>
        <SettingRow title={t("shell.settings.omo.serverTitle")} hint={t("shell.settings.omo.restartHint")}>
          <Button
            variant="outline"
            size="sm"
            icon={<RefreshCw aria-hidden="true" />}
            data-testid={TESTID.restartOmo}
            disabled={restart.kind === "running" || installing || updating}
            onClick={runRestart}
          >
            {restart.kind === "running" ? t("shell.settings.omo.restarting") : t("shell.settings.omo.restart")}
          </Button>
        </SettingRow>
        {restart.kind === "failed" && (
          <ErrorText className="pb-4">{t("shell.settings.omo.restartFailed", { message: restart.message })}</ErrorText>
        )}
        <SettingRow title={t("shell.settings.omo.installTitle")} hint={t("shell.settings.omo.installHint")}>
          <Button
            variant="primary"
            size="sm"
            icon={<Download aria-hidden="true" />}
            data-testid={TESTID.reinstallOmo}
            disabled={installing || updating}
            onClick={installer.start}
          >
            {installing ? t("shell.onboarding.installing") : t("shell.settings.omo.reinstall")}
          </Button>
        </SettingRow>
        <code className={clsx(ui.codeBlock, "-mt-1 mb-4")}>{getOmoInstallCommand(window.omo.platform)}</code>
        {installer.phase.kind !== "idle" && (
          <div className="pb-4">
            <InstallStatus installer={installer} />
          </div>
        )}
      </div>
    </section>
  );
}
