import { useEffect, useState } from "react";
import { RefreshCw, Smartphone, Unplug } from "lucide-react";
import { Button } from "../kit";
import type { AndroidStatus } from "../../../shared/android";
import { useT } from "../../i18n";
import { SectionHeading } from "./SectionHeading";
import { errorMessage } from "./diagnostics";
import { ErrorText, ui } from "./SettingsCard";

export function AndroidSection() {
  const t = useT();
  const [status, setStatus] = useState<AndroidStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<AndroidStatus>): Promise<void> => {
    setBusy(true); setError(null);
    try { setStatus(await action()); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let active = true;
    let updated = false;
    const unsubscribe = window.omo.onAndroidStatus((value) => { updated = true; if (active) setStatus(value); });
    void window.omo.getAndroidStatus().then((value) => { if (active && !updated) setStatus(value); }, (reason: unknown) => { if (active && !updated) setError(errorMessage(reason)); });
    return () => { active = false; unsubscribe(); };
  }, []);
  return <section className={ui.section} data-testid="settings-android" aria-busy={busy}>
    <SectionHeading title="Android" intro={t("shell.settings.android.intro")} />
    <div className={ui.card}><div className={ui.cardBody}>
      <p className={ui.muted}>{t("shell.settings.android.setup")}</p>
      <Button variant="outline" size="sm" icon={<RefreshCw aria-hidden="true" />} disabled={busy} data-testid="android-refresh" onClick={() => void run(() => window.omo.refreshAndroid())}>{t("shell.settings.android.refresh")}</Button>
      <p className={ui.text} role="status" data-testid="android-status">{t(`shell.settings.android.${status?.state ?? "searching"}`)}</p>
      {(error || status?.message) && <ErrorText>{error || status?.message}</ErrorText>}
      {status?.devices.map((device) => <div key={device.serial} className="flex flex-wrap items-center justify-between gap-3">
        <p className={ui.text}>{device.name} · <code className={ui.mono}>{device.serial}</code> · {t(`shell.settings.android.${device.state}`)}</p>
        <Button variant="outline" size="sm" icon={<Smartphone aria-hidden="true" />} disabled={busy || device.state !== "ready"} data-testid="android-connect" data-serial={device.serial} onClick={() => void run(() => window.omo.connectAndroid(device.serial))}>{t("shell.settings.android.connect")}</Button>
      </div>)}
      {status?.selectedSerial && <>
        <p className={ui.text}>{t("shell.settings.android.opened")}</p>
        <Button variant="outline" size="sm" icon={<Unplug aria-hidden="true" />} disabled={busy} data-testid="android-disconnect" onClick={() => void run(() => window.omo.disconnectAndroid())}>{t("shell.settings.android.disconnect")}</Button>
      </>}
    </div></div>
  </section>;
}
