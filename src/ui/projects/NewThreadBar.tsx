import { useMemo, useState } from "react";
import { Check, ChevronDown, FolderPlus, Laptop } from "lucide-react";
import { selectIsTurnActive, selectThreadsByWorkspace, useAppStore } from "../../state";
import { useT } from "../../i18n";
import { useActions, useAppSelector } from "../app-context";
import { workspaceName } from "../conversation/format";
import { Button, Menu } from "../kit";
import { errorMessage } from "../settings/diagnostics";
import { WorkspaceBadge } from "../sidebar/WorkspaceBadge";
import { updatePreferences, useUiState } from "../ui-state";
import { freshThreads, useFreshThread } from "./fresh-thread";
import { listProjects } from "./project-list";
import { PROJECT_TESTID } from "./testids";

type Transport = "private" | "shared";

/**
 * Chips above the composer of a thread the new-thread flow just started and that has no turn yet: the project
 * (switching starts the thread in the chosen folder instead) and the environment, this computer on the dedicated
 * or shared omo host (switching saves the shared-host preference and reconnects, as in Settings > Runtime).
 */
export function NewThreadBar() {
  const activeThreadId = useAppSelector((state) => state.activeThreadId);
  const fresh = useFreshThread(activeThreadId);
  const empty = useAppSelector((state) => activeThreadId !== null && (state.conversations[activeThreadId]?.turns.length ?? 0) === 0);
  const connected = useAppSelector((state) => state.bridge?.state === "connected");
  if (!fresh || !empty || !connected || activeThreadId === null) return null;
  return <Chips threadId={activeThreadId} />;
}

function Chips({ threadId }: { threadId: string }) {
  const t = useT();
  const actions = useActions();
  const store = useAppStore();
  const cwd = useAppSelector((state) => state.threads[threadId]?.cwd ?? null);
  const groups = useAppSelector(selectThreadsByWorkspace);
  const transport = useAppSelector((state) => (state.bridge?.state === "connected" ? state.bridge.transport : undefined));
  const anyTurnActive = useAppSelector((state) => Object.keys(state.threads).some((id) => selectIsTurnActive(state, id)));
  const { preferences } = useUiState();
  const recent = preferences?.recentWorkspaces;
  const projects = useMemo(() => listProjects(groups, recent ?? []), [groups, recent]);
  const [busy, setBusy] = useState(false);
  const current: Transport = transport ?? (preferences?.sharedHost === true ? "shared" : "private");

  const fail = (message: string): void => {
    store.dispatch({ type: "notice/pushed", notice: { id: crypto.randomUUID(), level: "error", message, threadId: null } });
  };

  /** Starts the thread in `target` instead; the empty thread leaves the sidebar's managed list (nothing is deleted). */
  const switchProject = async (target: string | null): Promise<void> => {
    setBusy(true);
    try {
      const folder = target ?? (await window.omo.pickDirectory(cwd));
      if (folder === null) return;
      const started = await actions.newThread(folder);
      if (started === null) return;
      freshThreads.mark(started);
      await actions.manageThread(threadId, false);
    } finally {
      setBusy(false);
    }
  };

  const switchHost = (next: Transport): void => {
    if (next === current) return;
    setBusy(true);
    updatePreferences({ sharedHost: next === "shared" })
      .then(() => window.omo.restart())
      .catch((error: unknown) => fail(t("env.chip.failed", { message: errorMessage(error) })))
      .finally(() => setBusy(false));
  };

  const hostLabel = t(current === "shared" ? "env.chip.shared" : "env.chip.private");
  const envValue = `${t("env.chip.thisComputer")} · ${hostLabel}`;
  const name = cwd === null ? "" : workspaceName(cwd);

  return (
    <div className="mx-auto box-border flex w-full max-w-200 flex-wrap items-center gap-2 px-5 pb-2" data-testid={PROJECT_TESTID.newThreadBar}>
      <Menu.Root>
        <Menu.Trigger
          disabled={busy}
          render={
            <Button variant="outline" size="sm" data-testid={PROJECT_TESTID.projectChip} aria-label={t("projects.chip.label", { name })} title={cwd ?? undefined}>
              {cwd !== null && <WorkspaceBadge cwd={cwd} size="sm" />}
              <span className="max-w-60 truncate">{name}</span>
              <ChevronDown aria-hidden="true" className="text-muted-foreground" />
            </Button>
          }
        />
        <Menu.Content side="top" className="w-80">
          <Menu.Group>
            <Menu.GroupLabel>{t("projects.chip.heading")}</Menu.GroupLabel>
            {projects.map((project) => {
              const selected = project.cwd === cwd;
              return (
                <Menu.Item
                  key={project.cwd}
                  data-testid={PROJECT_TESTID.projectOption}
                  data-cwd={project.cwd}
                  data-selected={selected ? "" : undefined}
                  title={project.cwd}
                  onClick={() => { if (!selected) void switchProject(project.cwd); }}
                >
                  <WorkspaceBadge cwd={project.cwd} size="sm" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{workspaceName(project.cwd)}</span>
                    <span className="truncate text-xs text-muted-foreground [direction:rtl] text-left"><bdi dir="ltr">{project.cwd}</bdi></span>
                  </span>
                  {selected && <Check aria-hidden="true" />}
                </Menu.Item>
              );
            })}
          </Menu.Group>
          <Menu.Separator />
          <Menu.Item data-testid={PROJECT_TESTID.projectNew} icon={<FolderPlus aria-hidden="true" />} onClick={() => void switchProject(null)}>
            <span className="flex min-w-0 flex-col">
              <span>{t("shell.newProject")}</span>
              <span className="text-xs text-muted-foreground">{t("projects.picker.newProjectHint")}</span>
            </span>
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
      <Menu.Root>
        <Menu.Trigger
          disabled={busy}
          render={
            <Button variant="ghost" size="sm" data-testid={PROJECT_TESTID.environmentChip} data-transport={current} aria-label={t("env.chip.label", { value: envValue })}>
              <Laptop aria-hidden="true" className="text-muted-foreground" />
              <span>{t("env.chip.thisComputer")}</span>
              <span className="text-muted-foreground">· {hostLabel}</span>
              <ChevronDown aria-hidden="true" className="text-muted-foreground" />
            </Button>
          }
        />
        <Menu.Content side="top" className="w-72">
          <Menu.Group>
            <Menu.GroupLabel>{t("env.chip.thisComputer")}</Menu.GroupLabel>
            {(["private", "shared"] as const).map((option) => (
              <Menu.Item
                key={option}
                data-testid={PROJECT_TESTID.environmentOption}
                data-transport={option}
                disabled={anyTurnActive && option !== current}
                onClick={() => switchHost(option)}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span>{t(option === "shared" ? "env.chip.shared" : "env.chip.private")}</span>
                  <span className="text-xs text-muted-foreground">{t(option === "shared" ? "env.chip.sharedHint" : "env.chip.privateHint")}</span>
                </span>
                {option === current && <Check aria-hidden="true" />}
              </Menu.Item>
            ))}
          </Menu.Group>
          <Menu.Separator />
          <p className="m-0 px-2 py-1.5 text-xs text-muted-foreground">{t(anyTurnActive ? "env.chip.busy" : "env.chip.reconnect")}</p>
        </Menu.Content>
      </Menu.Root>
    </div>
  );
}
