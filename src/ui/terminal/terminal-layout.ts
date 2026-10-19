import { useSyncExternalStore } from "react";
import { shownTab, uiState } from "../ui-state";

/** "horizontal" lays a group's terminals side by side, "vertical" stacks them. */
export type SplitDirection = "horizontal" | "vertical";
/** Where the terminal panel lives: a drawer under the conversation or the side panel's terminal tab. */
export type TerminalPlacement = "bottom" | "side";

export interface TerminalGroup {
  id: string;
  terminalIds: string[];
  splitDirection: SplitDirection;
  /** Relative pane sizes, one per terminal (flex-grow weights). */
  sizes: number[];
}

/** One thread's terminals: groups (the panes shown together) in list order, the active ids and the drawer state. */
export interface ThreadTerminals {
  groups: TerminalGroup[];
  activeTerminalId: string;
  activeGroupId: string;
  /** Bottom drawer shown for this thread. */
  open: boolean;
  /** Bottom drawer height in px. */
  height: number;
  /** Terminal list visibility the user chose; null shows it whenever the thread has more than one terminal. */
  listOpen: boolean | null;
}

interface TerminalLayoutState {
  placement: TerminalPlacement;
  threads: Readonly<Record<string, ThreadTerminals>>;
}

export const DRAWER_MIN_HEIGHT = 120;
export const DRAWER_MAX_RATIO = 0.7;
export const DRAWER_DEFAULT_HEIGHT = 300;
const STORAGE_KEY = "omo-ui.terminal-layout.v1";
/** Layouts kept in storage; the least recently changed threads drop out first. */
const STORED_THREADS = 100;
const ID = /^[A-Za-z0-9_-]{1,64}$/u;

export function initialTerminals(first = 1): ThreadTerminals {
  return { groups: [{ id: `g${first}`, terminalIds: [`t${first}`], splitDirection: "horizontal", sizes: [1] }], activeTerminalId: `t${first}`, activeGroupId: `g${first}`, open: false, height: DRAWER_DEFAULT_HEIGHT, listOpen: null };
}

const DEFAULT_TERMINALS = initialTerminals();

/** @returns every terminal id of the layout in list order */
export function terminalIds(layout: ThreadTerminals): string[] {
  return layout.groups.flatMap(group => group.terminalIds);
}

/** @returns the number a terminal is listed under ("Terminal 3" for `t3`) */
export function terminalNumber(id: string): number {
  return Number(/\d+$/u.exec(id)?.[0] ?? 0);
}

/** The number after the highest one in use; a closed terminal's shell is killed before its id can come back. */
function nextNumber(layout: ThreadTerminals): number {
  return Math.max(0, ...terminalIds(layout).map(terminalNumber), ...layout.groups.map(group => terminalNumber(group.id))) + 1;
}

/** Drops empty groups, repairs sizes and points the active ids at an existing terminal (the first one as fallback). */
export function normalizeTerminals(layout: ThreadTerminals): ThreadTerminals | null {
  const groups = layout.groups.filter(group => group.terminalIds.length > 0).map(group => group.sizes.length === group.terminalIds.length && group.sizes.every(size => Number.isFinite(size) && size > 0)
    ? group : { ...group, sizes: group.terminalIds.map(() => 1) });
  const first = groups[0]?.terminalIds[0];
  if (first === undefined) return null;
  const activeTerminalId = groups.some(group => group.terminalIds.includes(layout.activeTerminalId)) ? layout.activeTerminalId : first;
  const activeGroupId = groups.find(group => group.terminalIds.includes(activeTerminalId))!.id;
  return { ...layout, groups, activeTerminalId, activeGroupId };
}

/** A new terminal in a new group of its own, made active. */
export function addTerminal(layout: ThreadTerminals): ThreadTerminals {
  const n = nextNumber(layout);
  return { ...layout, groups: [...layout.groups, { id: `g${n}`, terminalIds: [`t${n}`], splitDirection: "horizontal", sizes: [1] }], activeTerminalId: `t${n}`, activeGroupId: `g${n}` };
}

/** A new terminal next to the active one in the active group, which then splits in `direction` with equal panes. */
export function splitTerminal(layout: ThreadTerminals, direction: SplitDirection): ThreadTerminals {
  const id = `t${nextNumber(layout)}`;
  const groups = layout.groups.map(group => {
    if (group.id !== layout.activeGroupId) return group;
    const index = group.terminalIds.indexOf(layout.activeTerminalId);
    const terminalIds = [...group.terminalIds.slice(0, index + 1), id, ...group.terminalIds.slice(index + 1)];
    return { ...group, terminalIds, splitDirection: direction, sizes: terminalIds.map(() => 1) };
  });
  return { ...layout, groups, activeTerminalId: id };
}

export function activateTerminal(layout: ThreadTerminals, id: string): ThreadTerminals {
  const group = layout.groups.find(entry => entry.terminalIds.includes(id));
  return group === undefined ? layout : { ...layout, activeTerminalId: id, activeGroupId: group.id };
}

/** @returns the layout without terminal `id`, or null when it was the last one */
export function removeTerminal(layout: ThreadTerminals, id: string): ThreadTerminals | null {
  const groups = layout.groups.map(group => {
    const index = group.terminalIds.indexOf(id);
    return index < 0 ? group : { ...group, terminalIds: group.terminalIds.filter(entry => entry !== id), sizes: group.sizes.filter((_size, at) => at !== index) };
  });
  // The neighbor in the same group takes over, so closing a split pane keeps the remaining panes on screen.
  const group = layout.groups.find(entry => entry.terminalIds.includes(id));
  const index = group?.terminalIds.indexOf(id) ?? -1;
  const neighbor = layout.activeTerminalId === id ? group?.terminalIds[index + 1] ?? group?.terminalIds[index - 1] : undefined;
  return normalizeTerminals({ ...layout, groups, activeTerminalId: neighbor ?? layout.activeTerminalId });
}

function isLayout(value: unknown): value is ThreadTerminals {
  if (typeof value !== "object" || value === null) return false;
  const layout = value as Partial<ThreadTerminals>;
  return Array.isArray(layout.groups) && layout.groups.every(group => typeof group === "object" && group !== null && typeof group.id === "string" && ID.test(group.id)
      && (group.splitDirection === "horizontal" || group.splitDirection === "vertical") && Array.isArray(group.sizes) && group.sizes.every(size => typeof size === "number")
      && Array.isArray(group.terminalIds) && group.terminalIds.every(id => typeof id === "string" && ID.test(id)))
    && new Set(layout.groups.flatMap(group => group.terminalIds)).size === layout.groups.flatMap(group => group.terminalIds).length
    && typeof layout.activeTerminalId === "string" && typeof layout.activeGroupId === "string" && typeof layout.open === "boolean"
    && typeof layout.height === "number" && Number.isFinite(layout.height) && (layout.listOpen === null || typeof layout.listOpen === "boolean");
}

/** @returns the stored placement and per-thread layouts; anything malformed falls back to the defaults */
export function parseTerminalLayout(raw: string | null): TerminalLayoutState {
  const fallback: TerminalLayoutState = { placement: "bottom", threads: {} };
  if (raw === null) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return fallback;
    const { placement, threads } = value as { placement?: unknown; threads?: unknown };
    const parsed: Record<string, ThreadTerminals> = {};
    if (typeof threads === "object" && threads !== null) {
      for (const [id, layout] of Object.entries(threads)) {
        const normal = isLayout(layout) ? normalizeTerminals(layout) : null;
        if (normal !== null) parsed[id] = normal;
      }
    }
    return { placement: placement === "side" ? "side" : "bottom", threads: parsed };
  } catch { return fallback; }
}

let state: TerminalLayoutState = (() => {
  try { return parseTerminalLayout(window.localStorage.getItem(STORAGE_KEY)); } catch { return parseTerminalLayout(null); }
})();
const listeners = new Set<() => void>();

function commit(next: TerminalLayoutState): void {
  state = next;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** @returns the thread's layout, or the single-terminal default for a thread without one */
export function terminalsOf(threadId: string | null): ThreadTerminals {
  return (threadId === null ? undefined : state.threads[threadId]) ?? DEFAULT_TERMINALS;
}

function updateThread(threadId: string, change: (layout: ThreadTerminals) => ThreadTerminals): void {
  const current = terminalsOf(threadId);
  const next = change(current);
  if (next === current) return;
  // Re-inserting moves the thread to the end, so the oldest layouts are the ones trimmed.
  const { [threadId]: _previous, ...rest } = state.threads;
  const entries = Object.entries(rest);
  commit({ ...state, threads: Object.fromEntries([...entries.slice(Math.max(0, entries.length - STORED_THREADS + 1)), [threadId, next]]) });
}

export const terminalLayout = {
  get: (): TerminalLayoutState => state,
  subscribe,
  setPlacement: (placement: TerminalPlacement): void => { if (state.placement !== placement) commit({ ...state, placement }); },
  setOpen: (threadId: string, open: boolean): void => updateThread(threadId, layout => layout.open === open ? layout : { ...layout, open }),
  setHeight: (threadId: string, height: number): void => updateThread(threadId, layout => ({ ...layout, height: Math.round(height) })),
  setListOpen: (threadId: string, listOpen: boolean): void => updateThread(threadId, layout => ({ ...layout, listOpen })),
  newTerminal: (threadId: string): void => updateThread(threadId, addTerminal),
  split: (threadId: string, direction: SplitDirection): void => updateThread(threadId, layout => splitTerminal(layout, direction)),
  activate: (threadId: string, id: string): void => updateThread(threadId, layout => activateTerminal(layout, id)),
  setSizes: (threadId: string, groupId: string, sizes: number[]): void => updateThread(threadId, layout => ({ ...layout, groups: layout.groups.map(group => group.id === groupId ? { ...group, sizes } : group) })),
  /** Removes `id`; closing the last terminal leaves a fresh single-terminal layout behind and closes the panel. */
  close: (threadId: string, id: string): void => {
    const remaining = removeTerminal(terminalsOf(threadId), id);
    if (remaining !== null) { updateThread(threadId, () => remaining); return; }
    updateThread(threadId, layout => ({ ...initialTerminals(nextNumber(layout)), height: layout.height }));
    uiState.closeRightTab("terminal");
  },
};

export function useTerminalLayout(): TerminalLayoutState {
  return useSyncExternalStore(subscribe, () => state);
}

/**
 * The terminal toggle (shortcut and palette): closes the terminal wherever it shows, otherwise opens it at the preferred
 * placement. Without a thread the side panel opens, which explains that a session is needed.
 */
export function toggleTerminal(threadId: string | null): void {
  if (shownTab(uiState.get()) === "terminal") { uiState.closeRightTab("terminal"); return; }
  if (state.placement === "side" || threadId === null) { uiState.setRightTab("terminal"); return; }
  terminalLayout.setOpen(threadId, !terminalsOf(threadId).open);
}

/** Moves the panel between the bottom drawer and the side panel; the shells keep running and replay into the new place. */
export function moveTerminal(threadId: string | null, placement: TerminalPlacement): void {
  terminalLayout.setPlacement(placement);
  if (placement === "side") {
    if (threadId !== null) terminalLayout.setOpen(threadId, false);
    uiState.setRightTab("terminal");
  } else {
    if (threadId !== null) terminalLayout.setOpen(threadId, true);
    uiState.closeRightTab("terminal");
  }
}
