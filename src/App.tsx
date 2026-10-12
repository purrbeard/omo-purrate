import { resolveProfile } from "./ui/composer/model-profiles";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { modalSelector, observeComposition } from "@deepseek-ai/dsh-client-ui-primitives";
import type { MenuCommand } from "../shared/ipc";
import { createActions, createAppStore, localSideStorage, selectAgentChildren, selectMainThreadId, selectTasks, selectManagedThreadsByWorkspace, useAppStore } from "./state";
import { I18nProvider, resolveLocale, useT } from "./i18n";
import { ActionsContext, StoreContext, useActions, useAppSelector } from "./ui/app-context";
import { SIDE_PANEL_WIDTH, SidePanel } from "./ui/btw/SidePanel";
import { useSidePanelShortcut } from "./ui/btw/SideToggle";
import { Composer } from "./ui/composer/Composer";
import { ConversationPane } from "./ui/conversation/ConversationPane";
import { useNewSessionFlow } from "./ui/new-session";
import { NoticeToasts } from "./ui/notices/NoticeToasts";
import { ThreadNotifications } from "./ui/notices/ThreadNotifications";
import { ConnectionBanner } from "./ui/onboarding/ConnectionBanner";
import { AppFrame } from "./ui/shell/AppFrame";
import { RightDock, useTerminalShortcut } from "./ui/shell/RightDock";
import { Sidebar } from "./ui/sidebar/Sidebar";
import { applyThemePreference } from "./ui/theme";
import { shownTab, uiState, useUiState, WORKFLOW_PANEL_WIDTHS } from "./ui/ui-state";
import type { RightTab, WorkView } from "./ui/ui-state";
import { WorkflowPanel } from "./ui/conversation/WorkflowPanel";
import { ProjectPickerHost } from "./ui/projects/ProjectPickerHost";
import { CommandPalette } from "./ui/palette/CommandPalette";
import { buildPaletteEntries } from "./ui/palette/palette-model";
import { APP_SHORTCUTS, rendererShortcut, shortcutKeys } from "./ui/shortcuts";
import { threadTitle } from "./ui/conversation/format";
import { TESTID } from "./ui/testids";
import { selectPinnedThreads } from "./state/selectors";
import type { ThreadSummary } from "./state";

// Surfaces that are closed at startup load on first use, keeping them out of the entry chunk.
const Onboarding = lazy(() => import("./ui/onboarding/Onboarding").then(module => ({ default: module.Onboarding })));
const SettingsDialog = lazy(() => import("./ui/settings/SettingsDialog").then(module => ({ default: module.SettingsDialog })));
const TerminalPanel = lazy(() => import("./ui/terminal/TerminalPanel").then(module => ({ default: module.TerminalPanel })));
const WorkspacePanel = lazy(() => import("./ui/workspace/WorkspacePanel").then(module => ({ default: module.WorkspacePanel })));
const SetupWizard = lazy(() => import("./ui/wizard/SetupWizard").then(module => ({ default: module.SetupWizard })));

function MainPane() {
  return (
    <>
      <ConnectionBanner />
      <ConversationPane />
      <Composer />
    </>
  );
}

type Placement = "docked" | "overlay";

const PANELS: Record<RightTab, (placement: Placement) => JSX.Element> = {
  work: (placement) => <WorkflowPanel placement={placement} />,
  btw: (placement) => <SidePanel placement={placement} />,
  terminal: (placement) => <TerminalPanel placement={placement} />,
  files: (placement) => <WorkspacePanel placement={placement} />,
};

function dockWidth(tab: RightTab, workflowWidth: number, workView: WorkView): number {
  switch (tab) {
    case "work": return workView === "agents" ? 560 : workflowWidth;
    case "btw": return SIDE_PANEL_WIDTH;
    case "terminal": return 440;
    case "files": return 440;
  }
}

function Shell() {
  const bridgeState = useAppSelector((state) => state.bridge?.state ?? null);
  useSidePanelShortcut();
  const actions = useActions();
  const store = useAppStore();
  const t = useT();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const composing = useRef(false);
  const appState = useAppSelector(state => state);
  const ui = useUiState();
  const { sidebarVisible, sidebarWidth, workflowPanelSize, onboardingOpen, settingsOpen, preferences, rightWidths, dockSide } = ui;
  const hasAgents = useAppSelector(state => {
    const main = selectMainThreadId(state);
    return main !== null && (selectAgentChildren(state, main).length > 0 || selectTasks(state, main).length > 0 || state.threadLinks.some(link => link.parentId === main && link.taskId !== undefined));
  });
  useEffect(() => uiState.setWorkAvailable(hasAgents), [hasAgents]);
  const activeTab: RightTab | null = shownTab({ ...ui, workAvailable: hasAgents });
  const newSession = useNewSessionFlow();
  const groups = useMemo(() => selectManagedThreadsByWorkspace(appState, preferences?.managedThreadIds ?? []), [appState, preferences?.managedThreadIds]);
  const sessions = useMemo(() => {
    const result = new Map<string, ThreadSummary>();
    const append = (thread: ThreadSummary): void => {
      if (!result.has(thread.id)) result.set(thread.id, thread);
      for (const child of thread.children ?? []) append(child);
    };
    for (const thread of selectPinnedThreads(appState, preferences?.pinnedThreadIds ?? [])) append(thread);
    for (const group of groups) for (const thread of group.threads) append(thread);
    return [...result.values()];
  }, [groups, appState, preferences?.pinnedThreadIds]);

  const openPalette = (): void => {
    if (!composing.current && document.querySelector(modalSelector) === null) setPaletteOpen(true);
  };
  const runCommand = (command: MenuCommand): void => {
    if (composing.current) return;
    switch (command) {
      case "settings": uiState.setSettingsOpen(true); break;
      case "new-session":
      case "open-project": void newSession(); break;
      case "toggle-sidebar": uiState.toggleSidebar(); break;
      case "command-palette": openPalette(); break;
      case "toggle-agents": uiState.toggleWork("agents"); break;
      case "toggle-workflow": uiState.toggleWork("graph"); break;
      case "toggle-files": uiState.toggleRightTab("files"); break;
      case "toggle-terminal": uiState.toggleRightTab("terminal"); break;
      case "toggle-side-chat": actions.setSidePanel(shownTab(uiState.get()) !== "btw"); break;
      case "keyboard-shortcuts": uiState.setSettingsOpen(true, "keybindings"); break;
    }
  };
  const paletteCommands: MenuCommand[] = ["new-session", "open-project", "settings", "toggle-sidebar", "toggle-agents", "toggle-workflow", "toggle-files", "toggle-terminal", "toggle-side-chat", "keyboard-shortcuts"];
  const paletteEntries = buildPaletteEntries(paletteCommands.map(id => {
    const shortcut = APP_SHORTCUTS.find(shortcut => shortcut.id === id)!;
    return { id, title: t(shortcut.label), shortcut: [...shortcutKeys(shortcut, window.omo.platform)], run: () => runCommand(id) };
  }), sessions.map(thread => ({ id: thread.id, title: threadTitle(thread, t("shell.untitledThread")), workspace: thread.cwd })), id => { void actions.openThread(id); });

  useEffect(() => {
    const root = document.documentElement;
    if (bridgeState === null) delete root.dataset["bridgeState"];
    else root.dataset["bridgeState"] = bridgeState;
  }, [bridgeState]);

  useEffect(() => window.omo.onMenuCommand(runCommand), [newSession, actions]);
  useTerminalShortcut();

  useEffect(() => {
    const composition = observeComposition(document);
    const start = (): void => { composing.current = true; };
    const end = (): void => { composing.current = false; };
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (composition.guards(event) || document.querySelector(modalSelector) !== null) return;
      const shortcut = rendererShortcut(event, window.omo.platform);
      if (shortcut === undefined) return;
      event.preventDefault();
      if (shortcut.id === "command-palette" || shortcut.id === "command-palette-alternate") openPalette();
      else if (shortcut.id === "session-number") {
        // The DOM reflects workspace collapse, search, settled sections and child expansion;
        // its order originates in the same selector as the sidebar (including pinned order).
        const sidebar = document.querySelector(`[data-testid="${TESTID.sidebar}"]`);
        const rows = sidebar?.querySelectorAll(`[data-testid="${TESTID.threadRow}"]`);
        const index = Number(event.key) - 1;
        const state = store.getState();
        const preferences = uiState.get().preferences;
        const pinned = selectPinnedThreads(state, preferences?.pinnedThreadIds ?? []);
        const pinnedIds = new Set(pinned.map(thread => thread.id));
        const id = rows === undefined
          ? [...pinned, ...selectManagedThreadsByWorkspace(state, preferences?.managedThreadIds ?? []).flatMap(group => group.threads).filter(thread => !pinnedIds.has(thread.id))][index]?.id
          : rows[index]?.getAttribute("data-thread-id");
        if (id != null) void actions.openThread(id);
      }
    };
    document.addEventListener("compositionstart", start, true);
    document.addEventListener("compositionend", end, true);
    window.addEventListener("blur", end);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      composition.dispose();
      document.removeEventListener("compositionstart", start, true);
      document.removeEventListener("compositionend", end, true);
      window.removeEventListener("blur", end);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [actions, store]);

  if (bridgeState === "not-found") {
    return (
      <>
        <Suspense fallback={null}><Onboarding /></Suspense>
        <NoticeToasts />
      </>
    );
  }
  return (
    <>
      <AppFrame
        sidebar={<Sidebar />}
        main={<MainPane />}
        sidebarVisible={sidebarVisible}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={uiState.setSidebarWidth}
        onCanDockChange={uiState.setCanDock}
        rightPanel={activeTab === null ? null : (placement: Placement) => <RightDock tab={activeTab} placement={placement}><Suspense fallback={null}>{PANELS[activeTab](placement)}</Suspense></RightDock>}
        rightPanelWidth={activeTab === null ? 0 : rightWidths[activeTab] ?? dockWidth(activeTab, WORKFLOW_PANEL_WIDTHS[workflowPanelSize], ui.workView)}
        onRightPanelWidthChange={activeTab === null ? undefined : (width) => uiState.setRightWidth(activeTab, width)}
        rightPanelSide={dockSide}
      />
      {settingsOpen && <Suspense fallback={null}><SettingsDialog /></Suspense>}
      {paletteOpen && <CommandPalette entries={paletteEntries} onClose={() => setPaletteOpen(false)} />}
      <ProjectPickerHost />
      {onboardingOpen && <Suspense fallback={null}><SetupWizard /></Suspense>}
      <ThreadNotifications />
      <NoticeToasts />
    </>
  );
}

export function App() {
  const store = useMemo(() => createAppStore(), []);
  const actions = useMemo(() => createActions(store, window.omo, { sideStorage: localSideStorage() }), [store]);
  const { preferences } = useUiState();

  useEffect(() => actions.connect(), [actions]);

  useEffect(() => {
    let current = true;
    void window.omo.getPreferences().then((loaded) => {
      if (current) {
        uiState.setPreferences(loaded);
        if (!loaded.onboardingCompleted) uiState.setOnboardingOpen(true);
        store.dispatch({ type: "composer/modelSelected", modelId: loaded.modelId, effort: null, profile: loaded.modelProfile });
      }
    });
    return () => {
      current = false;
    };
  }, []);

  const models = useSyncExternalStore(store.subscribe, () => store.getState().models);
  const profile = useSyncExternalStore(store.subscribe, () => store.getState().composer.profile);
  useEffect(() => {
    if (!profile || models.length === 0) return;
    const resolved = resolveProfile(models, profile, preferences?.profileModels);
    store.dispatch({ type: "composer/modelSelected", modelId: resolved.model?.id ?? null, effort: resolved.effort, profile });
  }, [models, store, profile, preferences?.profileModels]);

  const theme = preferences?.theme ?? "system";
  useEffect(() => applyThemePreference(theme), [theme]);
  const palette = preferences?.palette ?? "omo";
  useEffect(() => { document.body.dataset.palette = palette; }, [palette]);


  const locale = resolveLocale(preferences?.locale ?? "system", navigator.language);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <StoreContext.Provider value={store}>
      <ActionsContext.Provider value={actions}>
        <I18nProvider locale={locale}>
          <Shell />
        </I18nProvider>
      </ActionsContext.Provider>
    </StoreContext.Provider>
  );
}
