import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Archive, FolderOpen, Palette, Pencil, SquarePen, Trash2 } from "lucide-react";
import { PROJECT_COLORS, PROJECT_ICONS, PROJECT_NAME_MAX } from "../../../shared/project-settings";
import type { ProjectColor, ProjectIcon } from "../../../shared/project-settings";
import { useLocale, useT } from "../../i18n";
import { selectManagedThreadsByWorkspace } from "../../state";
import type { ThreadSummary } from "../../state";
import { useActions, useAppSelector } from "../app-context";
import { Button } from "../kit";
import { listProjects, projectKey } from "../projects/project-list";
import type { ProjectEntry } from "../projects/project-list";
import { ProjectBadge } from "../projects/ProjectBadge";
import { PROJECT_ICON_COMPONENTS, findProjectSetting, patchProjectSetting, projectColorStyle, projectDisplayName } from "../projects/project-style";
import { formatThreadFullTime } from "../sidebar/thread-time";
import { TESTID } from "../testids";
import { uiState, updatePreferences, useUiState } from "../ui-state";
import { errorMessage } from "./diagnostics";
import { ErrorText, SettingsCard, SettingsGroup, ui } from "./SettingsCard";

function threadIds(threads: readonly ThreadSummary[]): string[] {
  return threads.flatMap(thread => [thread.id, ...threadIds(thread.children ?? [])]);
}

export function ProjectsSection() {
  const t = useT();
  const locale = useLocale();
  const actions = useActions();
  const { preferences, projectsFocusCwd } = useUiState();
  const appState = useAppSelector(state => state);
  const managed = preferences?.managedThreadIds;
  const groups = useMemo(() => selectManagedThreadsByWorkspace(appState, managed ?? []), [appState, managed]);
  const projects = useMemo(() => listProjects(groups, preferences?.recentWorkspaces ?? []), [groups, preferences?.recentWorkspaces]);
  const settings = preferences?.projectSettings;
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [styling, setStyling] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());

  // Arriving from a sidebar group menu: scroll to that project once and mark it for a moment.
  useEffect(() => {
    if (projectsFocusCwd === null) return;
    const key = projectKey(projectsFocusCwd);
    rows.current.get(key)?.scrollIntoView({ block: "center" });
    setFocused(key);
    uiState.clearProjectsFocus();
  }, [projectsFocusCwd, projects]);

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };
  const save = (cwd: string, patch: Parameters<typeof patchProjectSetting>[2]): Promise<unknown> =>
    updatePreferences({ projectSettings: patchProjectSetting(settings, cwd, patch) });

  const commitRename = (project: ProjectEntry): void => {
    const name = draft.trim();
    setRenaming(null);
    void run(() => save(project.cwd, { name: name === "" ? undefined : name.slice(0, PROJECT_NAME_MAX) }));
  };

  const remove = (project: ProjectEntry): void => {
    const key = projectKey(project.cwd);
    const ids = new Set(groups.filter(group => projectKey(group.cwd) === key).flatMap(group => threadIds(group.threads)));
    const current = uiState.get().preferences;
    setRemoving(null);
    if (current === null) return;
    const lastWorkspace = current.lastWorkspace !== null && projectKey(current.lastWorkspace) === key ? null : current.lastWorkspace;
    const next = { ...current.projectSettings };
    for (const stored of Object.keys(next)) if (projectKey(stored) === key) delete next[stored];
    void run(() => updatePreferences({
      managedThreadIds: current.managedThreadIds.filter(id => !ids.has(id)),
      recentWorkspaces: current.recentWorkspaces.filter(cwd => projectKey(cwd) !== key),
      lastWorkspace,
      projectSettings: next,
    }));
  };

  return (
    <section className={ui.section} data-testid={TESTID.settingsProjects}>
      <SettingsGroup title={t("shell.settings.nav.projects")} intro={t("screens.projects.intro")} />
      {error !== null && <ErrorText>{error}</ErrorText>}
      {projects.length === 0 && <SettingsCard><p className={clsx(ui.muted, "py-4")}>{t("screens.projects.empty")}</p></SettingsCard>}
      {projects.map(project => {
        const key = projectKey(project.cwd);
        const setting = findProjectSetting(settings, project.cwd)?.setting;
        const name = projectDisplayName(settings, project.cwd);
        return (
          <div
            key={key}
            ref={element => { if (element === null) rows.current.delete(key); else rows.current.set(key, element); }}
            className={clsx(ui.card, "gap-3 py-4 transition-shadow", focused === key && "ring-2 ring-ring")}
            data-testid={TESTID.projectRow}
            data-cwd={project.cwd}
          >
            <div className="flex items-start gap-3">
              <ProjectBadge cwd={project.cwd} size="lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {renaming === key ? (
                  <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); commitRename(project); }}>
                    <input
                      className={clsx(ui.control, "min-w-0 flex-1")}
                      data-testid={TESTID.projectRenameInput}
                      aria-label={t("screens.projects.renameLabel")}
                      value={draft}
                      maxLength={PROJECT_NAME_MAX}
                      placeholder={t("screens.projects.renameHint")}
                      spellCheck={false}
                      autoFocus
                      onChange={event => setDraft(event.target.value)}
                      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setRenaming(null); } }}
                    />
                    <Button type="submit" size="sm" data-testid={TESTID.projectRenameSave}>{t("screens.projects.save")}</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setRenaming(null)}>{t("common.cancel")}</Button>
                  </form>
                ) : (
                  <div className="truncate text-sm leading-5 font-medium text-foreground">{name}</div>
                )}
                <div className="truncate text-xs leading-4.5 text-muted-foreground" title={project.cwd}>{project.cwd}</div>
                <div className="text-xs leading-4.5 text-muted-foreground">
                  {t("screens.projects.threads", { count: project.threadCount })} · {project.lastActivityMs === null ? t("screens.projects.noActivity") : t("screens.projects.lastActivity", { time: formatThreadFullTime(project.lastActivityMs, preferences?.timeFormat ?? "system", locale) })}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" icon={<Pencil aria-hidden="true" />} data-testid={TESTID.projectRename} onClick={() => { setDraft(setting?.name ?? ""); setRenaming(key); }}>{t("screens.projects.rename")}</Button>
              <Button variant="outline" size="sm" icon={<Palette aria-hidden="true" />} data-testid={TESTID.projectAppearance} aria-expanded={styling === key} onClick={() => setStyling(styling === key ? null : key)}>{t("screens.projects.appearance")}</Button>
              <Button variant="outline" size="sm" icon={<FolderOpen aria-hidden="true" />} data-testid={TESTID.projectReveal} onClick={() => void run(() => window.omo.revealPath(project.cwd))}>{t("screens.projects.reveal")}</Button>
              <Button variant="outline" size="sm" icon={<SquarePen aria-hidden="true" />} data-testid={TESTID.projectNewThread} onClick={() => { uiState.setSettingsOpen(false); void actions.newThread(project.cwd); }}>{t("screens.projects.newThread")}</Button>
              <Button variant="outline" size="sm" icon={<Archive aria-hidden="true" />} data-testid={TESTID.projectArchived} onClick={() => uiState.openArchive(project.cwd)}>{t("screens.projects.archived")}</Button>
              <Button variant="outline" size="sm" icon={<Trash2 aria-hidden="true" />} data-testid={TESTID.projectRemove} onClick={() => setRemoving(key)}>{t("screens.projects.remove")}</Button>
            </div>
            {removing === key && (
              <div className="flex flex-col gap-2 rounded-md border border-solid border-destructive/40 p-3" role="alertdialog" aria-label={t("screens.projects.removeTitle", { name })}>
                <p className={ui.text}>{t("screens.projects.removeTitle", { name })}</p>
                <p className={ui.muted}>{t("screens.projects.removeBody")}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setRemoving(null)}>{t("common.cancel")}</Button>
                  <Button variant="destructive" size="sm" icon={<Trash2 aria-hidden="true" />} data-testid={TESTID.projectRemoveConfirm} onClick={() => remove(project)}>{t("screens.projects.removeConfirm")}</Button>
                </div>
              </div>
            )}
            {styling === key && (
              <div className="flex flex-col gap-3 rounded-md bg-muted/50 p-3" role="group" aria-label={t("screens.projects.appearance")}>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("screens.projects.iconLabel")}>
                  {PROJECT_ICONS.map((icon: ProjectIcon) => {
                    const Icon = PROJECT_ICON_COMPONENTS[icon];
                    return (
                      <button
                        key={icon}
                        type="button"
                        className={clsx("inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-solid border-border bg-background text-foreground hover:bg-accent aria-pressed:border-ring aria-pressed:bg-accent [&_svg]:size-4", "focus-visible:outline-2 focus-visible:outline-ring")}
                        data-testid={TESTID.projectIconOption}
                        data-icon={icon}
                        aria-pressed={setting?.icon === icon}
                        aria-label={t("screens.projects.iconOption", { name: icon })}
                        onClick={() => void run(() => save(project.cwd, { icon }))}
                      >
                        <Icon aria-hidden />
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("screens.projects.colorLabel")}>
                  {PROJECT_COLORS.map((color: ProjectColor) => (
                    <button
                      key={color}
                      type="button"
                      className="size-6 cursor-pointer rounded-full border-2 border-solid border-transparent aria-pressed:border-foreground focus-visible:outline-2 focus-visible:outline-ring"
                      style={{ backgroundColor: projectColorStyle(color).color }}
                      data-testid={TESTID.projectColorOption}
                      data-color={color}
                      aria-pressed={setting?.color === color}
                      aria-label={t(`screens.projects.color.${color}`)}
                      onClick={() => void run(() => save(project.cwd, { color }))}
                    />
                  ))}
                  <Button variant="outline" size="sm" data-testid={TESTID.projectAppearanceReset} disabled={setting?.icon === undefined && setting?.color === undefined} onClick={() => void run(() => save(project.cwd, { icon: undefined, color: undefined }))}>
                    {t("screens.projects.default")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
