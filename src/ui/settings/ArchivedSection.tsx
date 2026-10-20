import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ArchiveRestore, ExternalLink, Search } from "lucide-react";
import { Button } from "../kit";
import type { Thread } from "../../../shared/protocol";
import { useLocale, useT } from "../../i18n";
import { useActions } from "../app-context";
import { archiveKey, archiveTitle, archivedProjects, groupArchived, UNKNOWN_PROJECT } from "../projects/archive-groups";
import { projectDisplayName } from "../projects/project-style";
import { formatThreadFullTime } from "../sidebar/thread-time";
import { TESTID } from "../testids";
import { uiState, useUiState } from "../ui-state";
import { errorMessage } from "./diagnostics";
import { ErrorText, SettingsCard, SettingsGroup, selectClass, ui } from "./SettingsCard";

const ALL_PROJECTS = "__all__";

export function ArchivedSection() {
  const t = useT();
  const locale = useLocale();
  const actions = useActions();
  const { preferences } = useUiState();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // A project handed over by "show archived threads" filters the screen once, then the handover is consumed.
  const [filter, setFilter] = useState<string | null>(() => {
    const cwd = uiState.get().archiveFilterCwd;
    return cwd === null ? null : archiveKey(cwd);
  });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => { uiState.setArchiveFilter(null); }, []);
  useEffect(() => {
    let active = true;
    void actions.listArchivedThreads().then(
      rows => { if (active) { setThreads(rows); setLoading(false); } },
      (reason: unknown) => { if (active) { setError(errorMessage(reason)); setLoading(false); } },
    );
    return () => { active = false; };
  }, [actions]);

  const settings = preferences?.projectSettings;
  const projects = useMemo(() => archivedProjects(threads), [threads]);
  const groups = useMemo(() => groupArchived(threads, query, filter), [threads, query, filter]);
  const projectName = (cwd: string): string => cwd === "" ? t("screens.archive.unknownProject") : projectDisplayName(settings, cwd);
  const visibleIds = groups.flatMap(group => group.threads.map(thread => thread.id));
  const chosen = visibleIds.filter(id => selected.has(id));

  const restore = async (ids: readonly string[], open: boolean): Promise<void> => {
    setPending(true);
    setError(null);
    const restored: string[] = [];
    let failure: string | null = null;
    for (const id of ids) {
      try {
        await actions.unarchiveThread(id);
        restored.push(id);
      } catch (reason) {
        failure = errorMessage(reason);
        break;
      }
    }
    setThreads(current => current.filter(thread => !restored.includes(thread.id)));
    setSelected(current => new Set([...current].filter(id => !restored.includes(id))));
    setPending(false);
    if (failure !== null) setError(failure);
    else if (open && restored[0] !== undefined) {
      uiState.setSettingsOpen(false);
      void actions.openThread(restored[0]);
    }
  };
  const toggle = (id: string): void => setSelected(current => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const emptyText = threads.length === 0 ? t("screens.archive.empty")
    : query.trim() !== "" ? t("screens.archive.noMatchQuery", { query: query.trim() })
    : t("screens.archive.noMatchProject", { project: filter === null ? "" : projectName(projects.find(project => project.key === filter)?.cwd ?? "") });

  return (
    <section className={ui.section} data-testid={TESTID.settingsArchived} aria-busy={loading}>
      <SettingsGroup title={t("shell.settings.nav.archived")} intro={t("screens.archive.intro")} />
      {error !== null && <ErrorText>{error}</ErrorText>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            className={clsx(ui.control, "w-full pl-8")}
            data-testid={TESTID.archiveSearch}
            aria-label={t("screens.archive.search")}
            placeholder={t("screens.archive.search")}
            value={query}
            spellCheck={false}
            onChange={event => setQuery(event.target.value)}
          />
        </div>
        <select
          className={selectClass}
          data-testid={TESTID.archiveProjectFilter}
          aria-label={t("screens.archive.projectFilter")}
          value={filter ?? ALL_PROJECTS}
          onChange={event => setFilter(event.target.value === ALL_PROJECTS ? null : event.target.value)}
        >
          <option value={ALL_PROJECTS}>{t("screens.archive.allProjects")}</option>
          {filter !== null && !projects.some(project => project.key === filter) && <option value={filter}>{filter === UNKNOWN_PROJECT ? t("screens.archive.unknownProject") : filter}</option>}
          {projects.map(project => <option key={project.key} value={project.key}>{projectName(project.cwd)}</option>)}
        </select>
        <Button variant="outline" size="sm" icon={<ArchiveRestore aria-hidden="true" />} data-testid={TESTID.archiveRestoreSelected} disabled={pending || chosen.length === 0} onClick={() => void restore(chosen, false)}>
          {t("screens.archive.restoreSelected", { count: chosen.length })}
        </Button>
      </div>
      <SettingsCard>
        <div className="flex flex-col py-2">
          {loading ? <p className={clsx(ui.muted, "py-2")}>{t("shell.settings.archived.loading")}</p>
            : groups.length === 0 ? <p className={clsx(ui.muted, "py-2")} data-testid={TESTID.archiveEmpty} role="status">{emptyText}</p>
            : groups.map(group => (
              <div key={group.key} className="flex flex-col" data-testid={TESTID.archiveGroup} data-project-key={group.key}>
                <div className="flex items-baseline gap-2 pt-3 pb-1">
                  <h4 className={ui.subheading}>{projectName(group.cwd)}</h4>
                  <span className="text-xs tabular-nums text-muted-foreground">{group.threads.length}</span>
                  {group.cwd !== "" && <span className="min-w-0 truncate text-xs text-muted-foreground" title={group.cwd}>{group.cwd}</span>}
                </div>
                {group.threads.map(thread => (
                  <div key={thread.id} className="flex items-center gap-3 border-0 border-solid border-border py-2.5 [&+&]:border-t" data-testid={TESTID.archivedThreadRow} data-thread-id={thread.id}>
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 cursor-pointer accent-primary"
                      data-testid={TESTID.archiveSelect}
                      aria-label={t("screens.archive.selectRow", { name: archiveTitle(thread) || t("shell.newSession") })}
                      checked={selected.has(thread.id)}
                      onChange={() => toggle(thread.id)}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="truncate text-sm leading-5 font-medium text-foreground">{archiveTitle(thread) || t("shell.newSession")}</div>
                      <div className="truncate text-xs leading-4.5 text-muted-foreground" title={thread.cwd}>
                        {projectName(thread.cwd)} · {t("screens.archive.updated", { time: formatThreadFullTime(thread.updatedAt * 1000, preferences?.timeFormat ?? "system", locale) })}
                      </div>
                    </div>
                    <Button variant="outline" size="sm" icon={<ExternalLink aria-hidden="true" />} data-testid={TESTID.archiveOpen} disabled={pending} onClick={() => void restore([thread.id], true)}>
                      {t("screens.archive.open")}
                    </Button>
                    <Button variant="outline" size="sm" icon={<ArchiveRestore aria-hidden="true" />} data-testid={TESTID.archivedRestore} disabled={pending} onClick={() => void restore([thread.id], false)}>
                      {t("shell.settings.archived.restore")}
                    </Button>
                  </div>
                ))}
              </div>
            ))}
        </div>
      </SettingsCard>
    </section>
  );
}
