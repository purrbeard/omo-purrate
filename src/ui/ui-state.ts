import { useSyncExternalStore } from "react";
import type { Preferences } from "../../shared/ipc";

export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_DEFAULT_WIDTH = 280;

export const WORKFLOW_PANEL_WIDTHS = { normal: 580, wide: 720, maximized: 840 } as const;
export type WorkflowPanelSize = keyof typeof WORKFLOW_PANEL_WIDTHS;
export type RightTab = "work" | "btw" | "terminal" | "files";
export const RIGHT_TABS: readonly RightTab[] = ["work", "btw", "terminal", "files"];
/** Views of the single Work panel: agent conversations, the run graph, the work list and the activity log. */
export type WorkView = "agents" | "graph" | "list" | "activity";
export type DockSide = "left" | "right";
const DOCK_LAYOUT_KEY = "omo-ui.dock-layout.v1";

/** @returns the stored tab order (every tab exactly once) and panel side, falling back to the defaults */
export function parseDockLayout(raw: string | null): { tabOrder: RightTab[]; dockSide: DockSide } {
  const fallback = { tabOrder: [...RIGHT_TABS], dockSide: "right" as DockSide };
  if (raw === null) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return fallback;
    const { tabOrder, dockSide } = value as { tabOrder?: unknown; dockSide?: unknown };
    // Layouts saved before Agents and Workflow merged into Work keep their order, with Work where the first of them was.
    const migrated = Array.isArray(tabOrder)
      ? [...new Set(tabOrder.map((tab: unknown) => (tab === "agents" || tab === "workflow" ? "work" : tab)))]
      : null;
    const order = migrated !== null && migrated.length === RIGHT_TABS.length && RIGHT_TABS.every((tab) => migrated.includes(tab))
      ? migrated as RightTab[] : fallback.tabOrder;
    return { tabOrder: order, dockSide: dockSide === "left" ? "left" : "right" };
  } catch { return fallback; }
}

/** @returns the order with `tab` moved to the position of `target` */
export function moveTab(order: readonly RightTab[], tab: RightTab, target: RightTab): RightTab[] {
  if (tab === target) return [...order];
  const rest = order.filter((entry) => entry !== tab);
  const index = rest.indexOf(target) + (order.indexOf(tab) < order.indexOf(target) ? 1 : 0);
  return [...rest.slice(0, index), tab, ...rest.slice(index)];
}

const storedLayout = (): { tabOrder: RightTab[]; dockSide: DockSide } => {
  try { return parseDockLayout(window.localStorage.getItem(DOCK_LAYOUT_KEY)); } catch { return parseDockLayout(null); }
};
const saveLayout = (): void => {
  try { window.localStorage.setItem(DOCK_LAYOUT_KEY, JSON.stringify({ tabOrder: state.tabOrder, dockSide: state.dockSide })); } catch { /* storage unavailable */ }
};
export type SettingsSection = "general" | "appearance" | "keybindings" | "model" | "skills" | "omo" | "accounts" | "mcp" | "android" | "iphone" | "devices" | "archived" | "about";

export interface UiState {
  rightTab: RightTab | null;
  /** Work opens by itself on wide screens when the main session has agents, until the user closes it. */
  agentAuto: boolean;
  /** Whether the main session has agents or work to show; App reports it so toggles see the auto-opened panel. */
  workAvailable: boolean;
  /** The view the Work panel shows. */
  workView: WorkView;
  /** The tab the dock toggle reopens. */
  lastTab: RightTab;
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
  /** Docked right panel widths the user dragged, per tab; a missing tab uses its default width. */
  rightWidths: Partial<Record<RightTab, number>>;
  /** User-arranged order of the side panel tabs. */
  tabOrder: RightTab[];
  /** Which side of the conversation the side panel docks on. */
  dockSide: DockSide;
  /** Last preferences read from or written through the bridge; null until the first load. */
  preferences: Preferences | null;
}

let state: UiState = {
  rightTab: null,
  agentAuto: true,
  workAvailable: false,
  workView: "agents",
  lastTab: "work",
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
  rightWidths: {},
  ...storedLayout(),
  preferences: null,
};
const listeners = new Set<() => void>();

/** @returns the tab the dock shows: the chosen one, or Work opened by itself for a session with agents */
export function shownTab(value: Pick<UiState, "rightTab" | "agentAuto" | "canDock" | "workAvailable">): RightTab | null {
  return value.rightTab ?? (value.agentAuto && value.canDock && value.workAvailable ? "work" : null);
}

function update(patch: Partial<UiState>): void {
  const next = { ...state, ...patch };
  const shown = shownTab(next);
  state = { ...next, lastTab: next.rightTab ?? next.lastTab, workspacePanelOpen: shown === "files", workflowPanelOpen: shown === "work" && next.workView !== "agents",
    agentPanelOpen: shown === "work" && next.workView === "agents" };
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
  /** Closes the panel the dock shows (including Work opened by itself) or opens `tab`. */
  toggleRightTab: (tab: RightTab): void => update(shownTab(state) === tab ? { rightTab: null, agentAuto: false } : { rightTab: tab }),
  /** Closes `tab` when the dock shows it; closing the auto-opened Work keeps it closed for this window. */
  closeRightTab: (tab: RightTab): void => {
    if (shownTab(state) === tab) update({ rightTab: null, agentAuto: false });
  },
  /** Opens the dock on the last tab, or closes whatever it shows. */
  toggleDock: (): void => update(shownTab(state) !== null ? { rightTab: null, agentAuto: false } : { rightTab: state.lastTab }),
  /** Opens Work on `view`; with the same view already shown it closes Work. */
  toggleWork: (view: WorkView): void => update(shownTab(state) === "work" && state.workView === view ? { rightTab: null, agentAuto: false } : { rightTab: "work", workView: view }),
  openWork: (view: WorkView): void => update({ rightTab: "work", workView: view }),
  /** Switching the view of an auto-opened Work panel pins it, so it stays open (as an overlay) when the window narrows. */
  setWorkView: (workView: WorkView): void => update({ workView, ...(shownTab(state) === "work" ? { rightTab: "work" as const } : {}) }),
  setWorkAvailable: (workAvailable: boolean): void => { if (state.workAvailable !== workAvailable) update({ workAvailable }); },
  setWorkspacePanelOpen: (open: boolean): void => open ? update({ rightTab: "files" }) : uiState.closeRightTab("files"),
  setWorkflowPanelOpen: (open: boolean): void => open ? uiState.openWork(state.workView === "agents" ? "graph" : state.workView) : uiState.closeRightTab("work"),
  setAgentPanelOpen: (open: boolean): void => open ? uiState.openWork("agents") : uiState.closeRightTab("work"),
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
  setRightWidth: (tab: RightTab, width: number): void => update({ rightWidths: { ...state.rightWidths, [tab]: Math.round(width) } }),
  moveTab: (tab: RightTab, target: RightTab): void => { update({ tabOrder: moveTab(state.tabOrder, tab, target) }); saveLayout(); },
  setDockSide: (dockSide: DockSide): void => { update({ dockSide }); saveLayout(); },
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
