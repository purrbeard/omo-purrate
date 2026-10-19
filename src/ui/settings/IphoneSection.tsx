import { useEffect, useState } from "react";
import type { IphoneStatus } from "../../../shared/ipc";
import { useT } from "../../i18n";
import { TESTID } from "../testids";
import { SectionHeading } from "./SectionHeading";
import { errorMessage } from "./diagnostics";
import { ErrorText, ui } from "./SettingsCard";

export function IphoneSection() {
  const t = useT();
  const [status, setStatus] = useState<IphoneStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let updated = false;
    const unsubscribe = window.omo.onIphoneStatus((value) => { updated = true; setStatus(value); });
    void window.omo.getIphoneStatus().then((value) => { if (active && !updated) setStatus(value); }, (reason: unknown) => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; unsubscribe(); };
  }, []);
  const state = status?.state ?? "searching";
  return <section className={ui.section} data-testid={TESTID.settingsIphone}>
    <SectionHeading title={t("shell.settings.nav.iphone")} intro={t(window.omo.platform === "win32" ? "shell.settings.iphone.unsupported" : "shell.settings.iphone.intro")} />
    <div className={ui.card}><div className={ui.cardBody}>
      <p className={ui.text} role="status" data-testid={TESTID.iphoneStatus} data-state={state}>{t(window.omo.platform === "win32" ? "shell.settings.iphone.unsupported" : status?.enabled === false ? "shell.settings.iphone.disabled" : `shell.settings.iphone.${state}`)}</p>
      {error && <ErrorText>{t("shell.settings.iphone.error", { message: error })}</ErrorText>}
      {status?.devices.map((device) => <dl className={ui.facts} key={device.id}>
        <dt>{t("shell.settings.iphone.device")}</dt><dd>{device.name} · {device.serial}</dd>
        <dt>{t("shell.settings.nav.iphone")}</dt><dd>{t(`shell.settings.iphone.${device.state}`)}</dd>
        <dt>{t("shell.settings.iphone.approval")}</dt><dd data-pending-approval={device.pendingApproval}>{t(device.pendingApproval ? "shell.settings.iphone.approvalPending" : "shell.settings.iphone.approvalNone")}</dd>
      </dl>)}
    </div></div>
  </section>;
}
