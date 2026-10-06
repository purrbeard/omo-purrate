/**
 * /btw side chats: the registry of side threads per main thread, the panel state, and the rules that keep side
 * threads out of the main thread list. omo's own /btw exists only in its TUI, so OmO UI runs each side chat as a
 * separate omo thread whose first message carries the main thread's read-only background.
 */
import type { AppEvent, AppState, BtwState, Notice, SideChat, ThreadSummary } from "./types";

/** First line of every side chat's first message; a thread whose preview starts with it is a side chat. */
export const SIDE_BACKGROUND_MARKER = "[OmO UI side chat background]";
/** Display-name prefix OmO UI gives side threads through thread/name/set. */
export const SIDE_NAME_PREFIX = "BTW: ";
const SIDE_NAME_MAX_CHARS = 60;

type BtwEvent = Extract<AppEvent, { type: `btw/${string}` }>;

export function emptyBtwState(): BtwState {
  return { open: false, sides: {}, selected: {}, detached: {}, drafts: {}, pending: {}, unclaimed: {}, restored: false };
}

export interface BtwCommand {
  /** The text after the command, trimmed; empty for a bare command. */
  question: string;
}

/**
 * Parses a draft that starts with `/btw` or its alias `/side` (any letter case), optionally followed by whitespace
 * and a question.
 * @param text the composer draft
 * @returns the command, or null for any other text (including `/btwx` and `/btw` after other words)
 */
export function parseBtwCommand(text: string): BtwCommand | null {
  const match = /^\/(?:btw|side)(?:\s+([\s\S]*))?$/iu.exec(text.trim());
  return match === null ? null : { question: (match[1] ?? "").trim() };
}

/**
 * @param question the side chat's first question
 * @returns the omo display name for its thread: the prefix plus the question's first line, at most 60 characters
 */
export function sideName(question: string): string {
  const line = (question.split("\n", 1)[0] ?? "").trim();
  const short = line.length > SIDE_NAME_MAX_CHARS ? `${line.slice(0, SIDE_NAME_MAX_CHARS - 1)}…` : line;
  return `${SIDE_NAME_PREFIX}${short}`;
}

/**
 * @param parentId the main thread
 * @param sideId the selected side chat, or null for the main thread's new-side composer
 * @returns the key of that composer's draft in `BtwState.drafts`
 */
export function sideDraftKey(parentId: string, sideId: string | null): string {
  return sideId === null ? `new:${parentId}` : `side:${sideId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates side chats read back from storage, which the type system does not cover.
 * @param value the parsed stored JSON
 * @returns the well-formed entries; malformed ones are dropped
 */
export function parseStoredSides(value: unknown): SideChat[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): SideChat[] => {
    if (!isRecord(entry)) return [];
    const { id, parentId, question, createdAtMs, context } = entry;
    if (typeof id !== "string" || id === "" || typeof parentId !== "string" || parentId === "") return [];
    if (typeof question !== "string" || typeof createdAtMs !== "number" || !Number.isFinite(createdAtMs)) return [];
    if (typeof context !== "boolean") return [];
    return [{ id, parentId, question, createdAtMs, context }];
  });
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return key in record ? Object.fromEntries(Object.entries(record).filter(([id]) => id !== key)) : record;
}

/**
 * Holds a thread that thread/started announced while a side start was pending in its cwd, so a side thread never
 * shows as a main thread before its side chat registers. The thread/start response claims it; a main thread that
 * OmO UI opens is released by `releaseHeldThread`.
 */
export function holdPendingSide(state: AppState, summary: ThreadSummary): AppState {
  const { btw } = state;
  if ((btw.pending[summary.cwd] ?? 0) === 0 || btw.sides[summary.id] !== undefined) return state;
  return { ...state, btw: { ...btw, unclaimed: { ...btw.unclaimed, [summary.id]: summary.cwd } } };
}

/** Releases a held thread once OmO UI opened it as a main thread. */
export function releaseHeldThread(state: AppState, threadId: string): AppState {
  const { btw } = state;
  return btw.unclaimed[threadId] === undefined ? state : { ...state, btw: { ...btw, unclaimed: without(btw.unclaimed, threadId) } };
}

/**
 * Forgets a deleted or archived thread both as a side chat (registry entry, draft, selection) and as a main thread
 * (selection, detached flag, new-side draft). The side chats of a deleted main thread stay registered until their
 * own deletion is reported.
 */
export function forgetThread(state: AppState, threadId: string): AppState {
  const { btw } = state;
  const side = btw.sides[threadId];
  const sides = without(btw.sides, threadId);
  const ownDraft = side === undefined ? btw.drafts : without(btw.drafts, sideDraftKey(side.parentId, threadId));
  const drafts = without(ownDraft, sideDraftKey(threadId, null));
  let selected = without(btw.selected, threadId);
  if (side !== undefined && selected[side.parentId] === threadId) selected = { ...selected, [side.parentId]: null };
  const detached = without(btw.detached, threadId);
  const unclaimed = without(btw.unclaimed, threadId);
  if (sides === btw.sides && drafts === btw.drafts && selected === btw.selected && detached === btw.detached && unclaimed === btw.unclaimed) {
    return state;
  }
  return { ...state, btw: { ...btw, sides, drafts, selected, detached, unclaimed } };
}

/** Applies a `btw/*` event; unchanged state keeps its reference. */
export function reduceBtw(state: AppState, event: BtwEvent): AppState {
  const { btw } = state;
  switch (event.type) {
    case "btw/restored": {
      if (btw.restored) return state;
      const stored: Record<string, SideChat> = {};
      for (const side of event.sides) stored[side.id] = side;
      return { ...state, btw: { ...btw, sides: { ...stored, ...btw.sides }, restored: true } };
    }
    case "btw/toggled":
      return btw.open === event.open ? state : { ...state, btw: { ...btw, open: event.open } };
    case "btw/selected":
      return (btw.selected[event.parentId] ?? null) === event.sideId
        ? state
        : { ...state, btw: { ...btw, selected: { ...btw.selected, [event.parentId]: event.sideId } } };
    case "btw/contextSet": {
      const attached = btw.detached[event.parentId] !== true;
      if (attached === event.attached) return state;
      const detached = event.attached ? without(btw.detached, event.parentId) : { ...btw.detached, [event.parentId]: true as const };
      return { ...state, btw: { ...btw, detached } };
    }
    case "btw/draftSet": {
      if ((btw.drafts[event.key] ?? "") === event.text) return state;
      const drafts = event.text === "" ? without(btw.drafts, event.key) : { ...btw.drafts, [event.key]: event.text };
      return { ...state, btw: { ...btw, drafts } };
    }
    case "btw/starting":
      return { ...state, btw: { ...btw, pending: { ...btw.pending, [event.cwd]: (btw.pending[event.cwd] ?? 0) + 1 } } };
    case "btw/started": {
      const remaining = (btw.pending[event.cwd] ?? 0) - 1;
      const pending = remaining > 0 ? { ...btw.pending, [event.cwd]: remaining } : without(btw.pending, event.cwd);
      const { side } = event;
      const claimed = side === null ? btw.unclaimed : without(btw.unclaimed, side.id);
      const unclaimed = remaining > 0 ? claimed : Object.fromEntries(Object.entries(claimed).filter(([, cwd]) => cwd !== event.cwd));
      if (side === null) return { ...state, btw: { ...btw, pending, unclaimed } };
      return {
        ...state,
        btw: {
          ...btw,
          pending,
          unclaimed,
          sides: { ...btw.sides, [side.id]: side },
          selected: { ...btw.selected, [side.parentId]: side.id },
        },
      };
    }
  }
}

/** True for a side chat's thread: registered, held while its side start is pending, or marked by its preview. */
export function isSideThread(state: AppState, summary: ThreadSummary): boolean {
  const { btw } = state;
  return btw.sides[summary.id] !== undefined || btw.unclaimed[summary.id] !== undefined || summary.preview.startsWith(SIDE_BACKGROUND_MARKER);
}

const NO_SIDES: SideChat[] = [];
const sideLists = new WeakMap<Record<string, SideChat>, Map<string, SideChat[]>>();

/**
 * @returns the side chats of `parentId`, oldest first; the same array while the registry is unchanged
 */
export function selectSidesOf(state: AppState, parentId: string | null): SideChat[] {
  if (parentId === null) return NO_SIDES;
  const { sides } = state.btw;
  let byParent = sideLists.get(sides);
  if (byParent === undefined) {
    byParent = new Map();
    sideLists.set(sides, byParent);
  }
  const cached = byParent.get(parentId);
  if (cached !== undefined) return cached;
  const list = Object.values(sides)
    .filter((side) => side.parentId === parentId)
    .sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
  const result = list.length === 0 ? NO_SIDES : list;
  byParent.set(parentId, result);
  return result;
}

/** Whether a notice renders inside the side chat panel instead of as a toast. */
export function isSideNotice(state: AppState, notice: Notice): boolean {
  return notice.scope === "side" || (notice.threadId !== null && state.btw.sides[notice.threadId] !== undefined);
}

/** The oldest notice the toast queue shows; side chat notices render in the panel instead. */
export function selectToastNotice(state: AppState): Notice | null {
  return state.notices.find((notice) => !isSideNotice(state, notice)) ?? null;
}

const NO_NOTICES: Notice[] = [];
const panelNotices = new Map<string, { source: Notice[]; result: Notice[] }>();

/**
 * @param parentId the main thread whose panel is shown
 * @param sideId the selected side chat, or null for the new-side composer
 * @returns that view's notices (a side chat's own notices, or the main thread's failed side starts), oldest first;
 *   the same array while the notices are unchanged
 */
export function selectPanelNotices(state: AppState, parentId: string | null, sideId: string | null): Notice[] {
  if (parentId === null) return NO_NOTICES;
  const key = `${parentId}\u0000${sideId ?? ""}`;
  const cached = panelNotices.get(key);
  if (cached !== undefined && cached.source === state.notices) return cached.result;
  const matching = state.notices.filter((notice) =>
    sideId === null ? notice.scope === "side" && notice.threadId === parentId : notice.threadId === sideId,
  );
  const result = matching.length === 0 ? NO_NOTICES : matching;
  panelNotices.set(key, { source: state.notices, result });
  return result;
}
