import { useSyncExternalStore } from "react";
import type { Preferences } from "../../shared/ipc";

export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_DEFAULT_WIDTH = 280;

export const WORKFLOW_PANEL_WIDTHS = { normal: 580, wide: 720, maximized: 840 } as const;
export type WorkflowPanelSize = keyof typeof WORKFLOW_PANEL_WIDTHS;
export type RightTab = "agents" | "btw" | "terminal" | "workflow" | "files";
export const RIGHT_TABS: readonly RightTab[] = ["agents", "btw", "terminal", "workflow", "files"];
export type SettingsSection = "general" | "appearance" | "keybindings" | "model" | "skills" | "omo" | "accounts" | "mcp" | "android" | "iphone" | "devices" | "about";

export interface UiState {
  rightTab: RightTab | null;
  /** Agents open by themselves on wide screens when the main session has agents, until the user closes them. */
  agentAuto: boolean;
  /** False while the frame is too narrow for a third column; auto-opened agents wait for room instead of covering the conversation. */
  canDock: boolean;
  workspacePanelOpen: boolean;
  workflowPanelOpen: boolean;
  agentPanelOpen: boolean;
  workflowPanelSize: WorkflowPanelSize;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  /** First-run wizard visibility; opens on launch until the onboardingCompleted preference is true. */
  onboardingOpen: boolean;
  sidebarVisible: boolean;
  sidebarWidth: number;
  /** Last preferences read from or written through the bridge; null until the first load. */
  preferences: Preferences | null;
}

let state: UiState = {
  rightTab: null,
  agentAuto: true,
  canDock: true,
  workspacePanelOpen: false,
  workflowPanelOpen: false,
  agentPanelOpen: true,
  workflowPanelSize: "normal",
  settingsOpen: false,
  settingsSection: "general",
  onboardingOpen: false,
  sidebarVisible: true,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  preferences: null,
};
const listeners = new Set<() => void>();

function update(patch: Partial<UiState>): void {
  const next = { ...state, ...patch };
  state = { ...next, workspacePanelOpen: next.rightTab === "files", workflowPanelOpen: next.rightTab === "workflow",
    agentPanelOpen: next.rightTab === "agents" || (next.rightTab === null && next.agentAuto && next.canDock) };
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

export const uiState = {
  setRightTab: (rightTab: RightTab | null): void => update({ rightTab, ...(rightTab === null ? { agentAuto: false } : {}) }),
  toggleRightTab: (tab: RightTab): void => update(state.rightTab === tab ? { rightTab: null, agentAuto: false } : { rightTab: tab }),
  closeRightTab: (tab: RightTab): void => {
    if (state.rightTab === tab) update({ rightTab: null, agentAuto: false });
    else if (tab === "agents" && state.rightTab === null) update({ agentAuto: false });
  },
  setWorkspacePanelOpen: (open: boolean): void => open ? update({ rightTab: "files" }) : uiState.closeRightTab("files"),
  setWorkflowPanelOpen: (open: boolean): void => open ? update({ rightTab: "workflow" }) : uiState.closeRightTab("workflow"),
  setAgentPanelOpen: (open: boolean): void => open ? update({ rightTab: "agents" }) : uiState.closeRightTab("agents"),
  disableAgentAuto: (): void => update({ agentAuto: false }),
  setCanDock: (canDock: boolean): void => { if (state.canDock !== canDock) update({ canDock }); },
  setWorkflowPanelSize: (workflowPanelSize: WorkflowPanelSize): void => update({ workflowPanelSize }),
  get: (): UiState => state,
  subscribe,
  setSettingsOpen: (settingsOpen: boolean, settingsSection?: SettingsSection): void => update({ settingsOpen, ...(settingsSection === undefined ? {} : { settingsSection }) }),
  setSettingsSection: (settingsSection: SettingsSection): void => update({ settingsSection }),
  setOnboardingOpen: (onboardingOpen: boolean): void => update({ onboardingOpen }),
  setSidebarVisible: (sidebarVisible: boolean): void => update({ sidebarVisible }),
  toggleSidebar: (): void => update({ sidebarVisible: !state.sidebarVisible }),
  setSidebarWidth: (width: number): void => update({ sidebarWidth: clampSidebarWidth(width) }),
  /** Records preferences loaded from the bridge or returned by `setPreferences`; App.tsx re-applies theme and locale from it. */
  setPreferences: (preferences: Preferences): void => update({ preferences }),
};

export function useUiState(): UiState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Writes a preferences patch through the bridge and records the stored result. */
export async function updatePreferences(patch: Partial<Preferences>): Promise<Preferences> {
  const next = await window.omo.setPreferences(patch);
  uiState.setPreferences(next);
  return next;
}
