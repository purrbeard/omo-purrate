import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "../kit";
import type { DeviceOverview } from "../../../shared/device-overview";
import type { AndroidStatus } from "../../../shared/android";
import { useT } from "../../i18n";
import { SectionHeading } from "./SectionHeading";
import { errorMessage } from "./diagnostics";
import { ErrorText, ui } from "./SettingsCard";

export function DevicesSection() {
  const t = useT();
  const [overview, setOverview] = useState<DeviceOverview | null>(null);
  const [android, setAndroid] = useState<AndroidStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let updated = false;
    const unsubscribe = window.omo.onAndroidStatus((value) => { updated = true; if (active) setAndroid(value); });
    void Promise.all([window.omo.getDeviceOverview(), window.omo.getAndroidStatus()]).then(([device, phone]) => { if (active) { setOverview(device); if (!updated) setAndroid(phone); } }, (reason: unknown) => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; unsubscribe(); };
  }, []);
  return <section className={ui.section} data-testid="settings-devices" aria-busy={overview === null && error === null}>
    <SectionHeading title={t("shell.settings.nav.devices")} intro={t("shell.settings.devices.intro")} />
    {error && <ErrorText>{error}</ErrorText>}
    <article className={ui.card}><div className={ui.cardBody}>
      <h3 className={ui.heading}>{t("shell.settings.devices.thisDevice")}</h3>
      <dl className={ui.facts}>
        <dt>{t("shell.settings.devices.name")}</dt><dd>{overview?.hostname ?? "—"}</dd>
        <dt>OS</dt><dd>{overview?.platform === "win32" ? "Windows" : overview?.platform ?? "—"}</dd>
        <dt>OmO UI</dt><dd>{overview?.appVersion ?? "—"}</dd>
        <dt>omo</dt><dd>{overview?.omoVersion ?? "—"}</dd>
      </dl>
      <h3 className={ui.heading}>Android</h3>
      <p className={ui.text}>{android?.selectedSerial ?? t("shell.settings.devices.noPhone")}</p>
      <p className={ui.muted}>{t("shell.settings.devices.phoneHint")}</p>
    </div></article>
    <article className={ui.card}><div className={ui.cardBody}>
      <h3 className={ui.heading}>{t("shell.settings.devices.memory")}</h3>
      <p className={ui.muted}>{t("shell.settings.devices.localHint")}</p>
      {overview?.memory.state === "available" ? <>
        <dl className={ui.facts}>
          <dt>{t("shell.settings.devices.branch")}</dt><dd>{overview.memory.branch}</dd>
          <dt>{t("shell.settings.devices.lastCommit")}</dt><dd>{overview.memory.lastCommitAt ? new Date(overview.memory.lastCommitAt).toLocaleString() : "—"}</dd>
          <dt>{t("shell.settings.devices.changes")}</dt><dd>{overview.memory.changedFiles}</dd>
          <dt>{t("shell.settings.devices.remote")}</dt><dd>{t(overview.memory.remoteConfigured ? "shell.settings.devices.configured" : "shell.settings.devices.notConfigured")}</dd>
        </dl>
        {overview.memory.path && <Button variant="outline" size="sm" icon={<FolderOpen aria-hidden="true" />} onClick={() => void window.omo.revealPath(overview.memory.path ?? "")}>{t("shell.settings.devices.openMemory")}</Button>}
      </> : overview !== null ? <p className={ui.muted}>{t("shell.settings.devices.noMemory")}</p> : null}
    </div></article>
  </section>;
}
