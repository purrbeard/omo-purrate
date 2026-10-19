import { useEffect, useState } from "react";
import clsx from "clsx";
import type { OpencodexAccounts as Snapshot } from "../../../shared/opencodex";
import { useT } from "../../i18n";
import { errorMessage } from "./diagnostics";
import { ErrorText, ui } from "./SettingsCard";

export function OpencodexAccounts({ refresh }: { refresh: boolean }) {
  const t = useT();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setError(null);
    void window.omo.readOpencodexAccounts().then((value) => { if (active) setSnapshot(value); }, (reason: unknown) => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, [refresh]);
  return <article className={ui.card} data-testid="opencodex-accounts" aria-busy={snapshot === null && error === null}>
    <div className={ui.cardBody}>
      <h3 className={ui.heading}>opencodex</h3>
      <p className={ui.muted}>{t("shell.settings.accounts.opencodexHint")}</p>
      {snapshot?.baseUrl && <p className={clsx(ui.mono, "m-0 text-muted-foreground")}>{snapshot.baseUrl}</p>}
      {(error || snapshot?.error) && <ErrorText>{error || snapshot?.error}</ErrorText>}
      {snapshot?.accounts.map((account) => <dl className={ui.facts} key={`${account.provider}:${account.id}`} data-testid="opencodex-account">
        <dt>{account.provider}</dt><dd>{account.name}{account.email && account.email !== account.name ? ` · ${account.email}` : ""}</dd>
        <dt>{t("shell.settings.accounts.opencodexState")}</dt><dd>{t(account.needsReauth ? "shell.settings.accounts.status.blocked" : account.paused ? "shell.settings.accounts.opencodexPaused" : account.active ? "shell.settings.accounts.opencodexActive" : "shell.settings.accounts.status.available")}</dd>
      </dl>)}
      {snapshot !== null && !snapshot.error && snapshot.accounts.length === 0 && <p className={ui.muted}>{t("shell.settings.accounts.empty")}</p>}
    </div>
  </article>;
}
