import { useEffect, useState } from "react";
import { Download, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "../kit";
import type { AppUpdateStatus } from "../../../shared/app-update";
import { selectIsTurnActive, useAppSelector } from "../../state";
import { useT } from "../../i18n";
import { SettingRow } from "./SectionHeading";
import { errorMessage } from "./diagnostics";
import { ErrorText, ui } from "./SettingsCard";

export function AppUpdateSection() {
  const t = useT();
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const turnActive = useAppSelector((state) => Object.keys(state.threads).some((id) => selectIsTurnActive(state, id)));
  useEffect(() => {
    let active = true;
    let updated = false;
    const unsubscribe = window.omo.onAppUpdateStatus((value) => { updated = true; if (active) setStatus(value); });
    void window.omo.getAppUpdateStatus().then((value) => { if (active && !updated) setStatus(value); }, (reason: unknown) => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; unsubscribe(); };
  }, []);
  const run = async (action: () => Promise<AppUpdateStatus>): Promise<void> => {
    setError(null);
    try { setStatus(await action()); }
    catch (reason) { setError(errorMessage(reason)); }
  };
  const busy = status?.state === "checking" || status?.state === "downloading" || status?.state === "installing";
  return <div className={ui.card} data-testid="app-update" aria-busy={busy}>
    <SettingRow title={t("shell.settings.appUpdate.title")} hint={t("shell.settings.appUpdate.hint")}>
      <Button variant="outline" size="sm" icon={<RefreshCw aria-hidden="true" />} disabled={busy || status?.state === "unsupported"} data-testid="app-update-check" onClick={() => void run(() => window.omo.checkAppUpdate())}>{t("shell.settings.appUpdate.check")}</Button>
    </SettingRow>
    <div className={ui.cardBody}>
      <p className={ui.text} role="status" data-testid="app-update-status" data-state={status?.state ?? "idle"}>{t(`shell.settings.appUpdate.${status?.state ?? "idle"}`)}</p>
      {status?.latestVersion && <p className={ui.muted}>{t("shell.settings.appUpdate.version", { current: status.currentVersion, latest: status.latestVersion })}</p>}
      {status?.progress !== null && status?.progress !== undefined && status.state === "downloading" && <progress className="h-1.5 w-full accent-foreground" max={100} value={status.progress} aria-label={t("shell.settings.appUpdate.downloading")} />}
      {(status?.state === "available" || status?.state === "ready") && <>
        <p className={ui.muted}>{t("shell.settings.appUpdate.installHint")}</p>
        <Button variant="primary" icon={<Download aria-hidden="true" />} disabled={turnActive || busy} data-testid="app-update-install" onClick={() => void run(() => window.omo.installAppUpdate())}>{t("shell.settings.appUpdate.install")}</Button>
      </>}
      {(error || status?.message) && <ErrorText>{error || status?.message}</ErrorText>}
      <Button variant="ghost" size="sm" icon={<ExternalLink aria-hidden="true" />} onClick={() => void window.omo.openExternal("https://github.com/purrbeard/omo-ui-windows/releases")}>{t("shell.settings.appUpdate.releases")}</Button>
    </div>
  </div>;
}
