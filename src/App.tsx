import { resolveProfile } from "./ui/composer/model-profiles";
import { lazy, Suspense, useEffect, useMemo, useSyncExternalStore } from "react";
import { createActions, createAppStore, localSideStorage, selectAgentChildren, selectMainThreadId, selectTasks } from "./state";
import { I18nProvider, resolveLocale } from "./i18n";
import { ActionsContext, StoreContext, useAppSelector } from "./ui/app-context";
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
import { uiState, useUiState, WORKFLOW_PANEL_WIDTHS } from "./ui/ui-state";
import type { RightTab } from "./ui/ui-state";
import { WorkflowPanel } from "./ui/conversation/WorkflowPanel";
import { AgentWorkspace } from "./ui/conversation/AgentWorkspace";
import { ProjectPickerHost } from "./ui/projects/ProjectPickerHost";

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
  agents: (placement) => <AgentWorkspace placement={placement} />,
  btw: (placement) => <SidePanel placement={placement} />,
  terminal: (placement) => <TerminalPanel placement={placement} onClose={() => uiState.closeRightTab("terminal")} />,
  workflow: (placement) => <WorkflowPanel placement={placement} />,
  files: (placement) => <WorkspacePanel placement={placement} onClose={() => uiState.setWorkspacePanelOpen(false)} />,
};

function dockWidth(tab: RightTab, workflowWidth: number): number {
  switch (tab) {
    case "agents": return 560;
    case "btw": return SIDE_PANEL_WIDTH;
    case "terminal": return 440;
    case "workflow": return workflowWidth;
    case "files": return 440;
  }
}

function Shell() {
  const bridgeState = useAppSelector((state) => state.bridge?.state ?? null);
  useSidePanelShortcut();
  useTerminalShortcut();
  const { sidebarVisible, sidebarWidth, workflowPanelSize, onboardingOpen, settingsOpen, rightTab, agentAuto, canDock } = useUiState();
  const hasAgents = useAppSelector(state => {
    const main = selectMainThreadId(state);
    return main !== null && (selectAgentChildren(state, main).length > 0 || selectTasks(state, main).length > 0 || state.threadLinks.some(link => link.parentId === main && link.taskId !== undefined));
  });
  const activeTab: RightTab | null = rightTab ?? (agentAuto && hasAgents && canDock ? "agents" : null);
  const newSession = useNewSessionFlow();

  useEffect(() => {
    const root = document.documentElement;
    if (bridgeState === null) delete root.dataset["bridgeState"];
    else root.dataset["bridgeState"] = bridgeState;
  }, [bridgeState]);

  useEffect(
    () =>
      window.omo.onMenuCommand((command) => {
        switch (command) {
          case "settings":
            uiState.setSettingsOpen(true);
            break;
          case "new-session":
            void newSession();
            break;
          case "toggle-sidebar":
            uiState.toggleSidebar();
            break;
        }
      }),
    [newSession],
  );

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
        rightPanelWidth={activeTab === null ? 0 : dockWidth(activeTab, WORKFLOW_PANEL_WIDTHS[workflowPanelSize])}
      />
      {settingsOpen && <Suspense fallback={null}><SettingsDialog /></Suspense>}
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
