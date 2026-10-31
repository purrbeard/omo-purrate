import license from "../../../LICENSE?raw";
import notice from "../../../NOTICE?raw";
import font from "../theme/fonts/Geist-OFL.txt?raw";
import { useLocale } from "../../i18n";
import { SettingsCard, ui } from "./SettingsCard";

/** Exact bundled notices, available without a network request. */
export function LicensesSection() {
  const ko = useLocale() === "ko";
  return <SettingsCard testId="settings-licenses"><div className={ui.cardBody}>
    <h3 className={ui.heading}>{ko ? "오픈 소스 고지" : "Open-source notices"}</h3>
    {[{ name: "LICENSE", text: license }, { name: "NOTICE", text: notice }, { name: "Geist OFL", text: font }].map(item => <details key={item.name}>
      <summary className="cursor-pointer text-sm">{item.name}</summary><pre className={`${ui.codeBlock} max-h-80`} data-license={item.name}>{item.text}</pre>
    </details>)}
    <p className={ui.muted}>{ko ? "Electron과 Chromium의 고지는 설치 폴더의 LICENSE.electron.txt와 LICENSES.chromium.html에 포함됩니다." : "Electron and Chromium notices are included as LICENSE.electron.txt and LICENSES.chromium.html in the installation folder."}</p>
  </div></SettingsCard>;
}
