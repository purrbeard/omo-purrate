import { useState } from "react";
import { useT } from "../../i18n";
import { useAppSelector } from "../app-context";
import { useSessionRuntime } from "../composer/use-session-runtime";
import { Button } from "../kit";
import { errorMessage } from "./diagnostics";
import { ErrorText, SettingsCard, SettingsGroup, SettingsRow, Toggle, ui } from "./SettingsCard";

export function SessionRuntimeSection() {
  const threadId = useAppSelector(state => state.activeThreadId);
  return threadId === null ? null : <Controls key={threadId} threadId={threadId} />;
}

function Controls({ threadId }: { threadId: string }) {
  const t = useT();
  const { runtime, error, refresh } = useSessionRuntime(threadId);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [retryApplied, setRetryApplied] = useState<boolean | null>(null);
  const save = async (patch: { autoCompaction?: boolean; autoRetry?: boolean }): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await window.omo.request("thread/runtime/set", { threadId, ...patch });
      if (patch.autoRetry !== undefined) setRetryApplied(patch.autoRetry);
      refresh();
    } catch (reason) { setFailure(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  return <section className={ui.section} data-testid="settings-session-runtime" aria-busy={busy}>
    <SettingsGroup title={t("shell.settings.runtime.title")} intro={t("shell.settings.runtime.intro")} />
    <SettingsCard>
      <SettingsRow title={t("shell.settings.runtime.compaction")} description={t("shell.settings.runtime.compactionHint")}>
        <Toggle testId="runtime-auto-compaction" label={t("shell.settings.runtime.compaction")} checked={runtime?.autoCompaction === true}
          disabled={busy || runtime?.autoCompaction == null} onChange={() => void save({ autoCompaction: !runtime?.autoCompaction })} />
      </SettingsRow>
      <SettingsRow title={t("shell.settings.runtime.retry")} description={t("shell.settings.runtime.retryHint")}>
        <Button size="sm" variant="outline" data-testid="runtime-retry-enable" disabled={busy || runtime === null} onClick={() => void save({ autoRetry: true })}>{t("shell.settings.runtime.enable")}</Button>
        <Button size="sm" variant="outline" data-testid="runtime-retry-disable" disabled={busy || runtime === null} onClick={() => void save({ autoRetry: false })}>{t("shell.settings.runtime.disable")}</Button>
      </SettingsRow>
      {retryApplied !== null && <p className={ui.cardFooter} role="status">{t(retryApplied ? "shell.settings.runtime.retryEnabled" : "shell.settings.runtime.retryDisabled")}</p>}
    </SettingsCard>
    {(failure ?? error) !== null && <ErrorText>{failure ?? error}</ErrorText>}
  </section>;
}
