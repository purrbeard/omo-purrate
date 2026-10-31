import { useEffect, useState } from "react";
import type { LoadedExtension } from "../../../shared/protocol";
import { useT } from "../../i18n";
import { selectActiveCwd } from "../../state";
import { useAppSelector } from "../app-context";
import { usePathActions } from "../content/media/use-path-actions";
import { Button } from "../kit";
import { errorMessage } from "./diagnostics";
import { ErrorText, SettingsCard, SettingsGroup, ui } from "./SettingsCard";

type Result = { threadId: string; cwd: string | null } & (
  | { kind: "loading" }
  | { kind: "ready"; extensions: LoadedExtension[] }
  | { kind: "error"; message: string }
);

export function ExtensionsSection() {
  const t = useT();
  const threadId = useAppSelector(state => state.activeThreadId);
  const cwd = useAppSelector(selectActiveCwd);
  const paths = usePathActions();
  const [result, setResult] = useState<Result | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (threadId === null) return;
    let current = true;
    setResult({ kind: "loading", threadId, cwd });
    void window.omo.request("thread/extensions/list", { threadId }).then(
      ({ extensions }) => { if (current) setResult({ kind: "ready", threadId, cwd, extensions }); },
      (error: unknown) => { if (current) setResult({ kind: "error", threadId, cwd, message: errorMessage(error) }); },
    );
    return () => { current = false; };
  }, [threadId, cwd, revision]);
  const visible = result?.threadId === threadId && result.cwd === cwd ? result : null;
  const loading = threadId !== null && (visible === null || visible.kind === "loading");
  return (
    <section className={ui.section} data-testid="settings-extensions" aria-busy={loading}>
      <SettingsGroup title={t("shell.settings.extensions.title")} intro={t("shell.settings.extensions.intro")}>
        <Button variant="outline" size="sm" data-testid="extensions-refresh" disabled={loading || threadId === null}
          onClick={() => setRevision(value => value + 1)}>{t("shell.settings.extensions.refresh")}</Button>
      </SettingsGroup>
      {threadId === null && <p className={ui.muted}>{t("shell.settings.extensions.noSession")}</p>}
      {loading && <p className={ui.muted} role="status">{t("shell.settings.extensions.loading")}</p>}
      {visible?.kind === "error" && <ErrorText>{visible.message}</ErrorText>}
      {visible?.kind === "ready" && visible.extensions.length === 0 && <p className={ui.muted}>{t("shell.settings.extensions.empty")}</p>}
      {visible?.kind === "ready" && visible.extensions.map(entry => (
        <SettingsCard key={entry.path} testId="settings-extension-row">
          <div className={ui.cardBody}>
            <div className="flex flex-wrap items-center gap-3">
              <h4 className={`${ui.heading} wrap-anywhere`}>{entry.name}</h4>
              <span className={ui.badge}>{t(entry.enabled ? "shell.settings.extensions.enabled" : "shell.settings.extensions.disabled")}</span>
            </div>
            <dl className={ui.facts}>
              <dt>{t("shell.settings.extensions.source")}</dt><dd>{entry.source}</dd>
              <dt>{t("shell.settings.extensions.scope")}</dt><dd>{entry.scope}</dd>
              <dt>{t("shell.settings.extensions.path")}</dt><dd className={ui.mono}>{entry.path}</dd>
            </dl>
            {!entry.path.startsWith("<builtin:") && <Button variant="outline" size="sm" onClick={() => paths.open(entry.path)}>{t("shell.settings.extensions.open")}</Button>}
          </div>
        </SettingsCard>
      ))}
      <p className={ui.muted}>{t("shell.settings.extensions.restartHint")}</p>
    </section>
  );
}
