import { useEffect, useState } from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import type { Thread } from "../../../shared/protocol";
import { useT } from "../../i18n";
import { useActions } from "../app-context";
import { TESTID } from "../testids";
import { SettingsCard, SettingsGroup } from "./SettingsCard";
import css from "./SettingsCard.module.css";

export function ArchivedSection() {
  const t = useT();
  const actions = useActions();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void actions.listArchivedThreads().then(
      rows => { if (active) { setThreads(rows); setLoading(false); } },
      (reason: unknown) => { if (active) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); } },
    );
    return () => { active = false; };
  }, [actions]);

  const restore = async (threadId: string): Promise<void> => {
    setPending(threadId);
    setError(null);
    try {
      await actions.unarchiveThread(threadId);
      setThreads(current => current.filter(thread => thread.id !== threadId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(null);
    }
  };

  return (
    <section className={css.section} data-testid={TESTID.settingsArchived} aria-busy={loading}>
      <SettingsGroup title={t("shell.settings.nav.archived")} />
      {error !== null && <p className={css.error} role="alert">{error}</p>}
      <SettingsCard>
        <div className={css.cardBody}>
          {loading ? <p className={css.muted}>{t("shell.settings.archived.loading")}</p>
            : threads.length === 0 ? <p className={css.muted}>{t("shell.settings.archived.empty")}</p>
            : threads.map(thread => (
              <div key={thread.id} className={css.listRow} data-testid={TESTID.archivedThreadRow} data-thread-id={thread.id}>
                <div className={css.rowText}>
                  <div className={css.rowTitle}>{thread.name || thread.preview || t("shell.newSession")}</div>
                  <div className={css.rowHint}>{thread.cwd}</div>
                </div>
                <Button data-testid={TESTID.archivedRestore} disabled={pending !== null} onClick={() => void restore(thread.id)}>
                  {t("shell.settings.archived.restore")}
                </Button>
              </div>
            ))}
        </div>
      </SettingsCard>
    </section>
  );
}
