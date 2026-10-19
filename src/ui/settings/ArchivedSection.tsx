import { useEffect, useState } from "react";
import clsx from "clsx";
import { ArchiveRestore } from "lucide-react";
import { Button } from "../kit";
import type { Thread } from "../../../shared/protocol";
import { useT } from "../../i18n";
import { useActions } from "../app-context";
import { TESTID } from "../testids";
import { errorMessage } from "./diagnostics";
import { ErrorText, SettingsCard, SettingsGroup, ui } from "./SettingsCard";

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
      (reason: unknown) => { if (active) { setError(errorMessage(reason)); setLoading(false); } },
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
      setError(errorMessage(reason));
    } finally {
      setPending(null);
    }
  };

  return (
    <section className={ui.section} data-testid={TESTID.settingsArchived} aria-busy={loading}>
      <SettingsGroup title={t("shell.settings.nav.archived")} />
      {error !== null && <ErrorText>{error}</ErrorText>}
      <SettingsCard>
        <div className="flex flex-col py-2">
          {loading ? <p className={clsx(ui.muted, "py-2")}>{t("shell.settings.archived.loading")}</p>
            : threads.length === 0 ? <p className={clsx(ui.muted, "py-2")}>{t("shell.settings.archived.empty")}</p>
            : threads.map(thread => (
              <div key={thread.id} className="flex items-center gap-3 border-0 border-solid border-border py-2.5 [&+&]:border-t" data-testid={TESTID.archivedThreadRow} data-thread-id={thread.id}>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="truncate text-sm leading-5 font-medium text-foreground">{thread.name || thread.preview || t("shell.newSession")}</div>
                  <div className="truncate text-xs leading-4.5 text-muted-foreground" title={thread.cwd}>{thread.cwd}</div>
                </div>
                <Button variant="outline" size="sm" icon={<ArchiveRestore aria-hidden="true" />} data-testid={TESTID.archivedRestore} disabled={pending !== null} onClick={() => void restore(thread.id)}>
                  {t("shell.settings.archived.restore")}
                </Button>
              </div>
            ))}
        </div>
      </SettingsCard>
    </section>
  );
}
