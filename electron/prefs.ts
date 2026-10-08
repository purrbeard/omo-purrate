import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_PREFERENCES } from "../shared/ipc";
import type { LocalePreference, ModelProfile, PalettePreference, Preferences, ThemePreference, ThreadCreatorEvidence, ThreadNotificationPreference, ThreadOrigin, TimeFormatPreference } from "../shared/ipc";

export { DEFAULT_PREFERENCES };

const THEMES: readonly ThemePreference[] = ["system", "light", "dark"];
const PALETTES: readonly PalettePreference[] = ["omo", "classic", "mint", "ocean", "sbd"];
const LOCALES: readonly LocalePreference[] = ["system", "en", "ko"];
const PROFILES: readonly ModelProfile[] = ["daily-normal", "daily-heavy", "geeky-normal", "geeky-heavy"];
const MAX_RECENT = 10;

const THREAD_NOTIFICATION_MODES: readonly ThreadNotificationPreference[] = ["off", "background", "always"];
const TIME_FORMATS: readonly TimeFormatPreference[] = ["system", "12h", "24h"];
const MIN_SETTLE_DAYS = 1;
const MAX_SETTLE_DAYS = 365;
const MAX_SETTLED = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick<T extends string>(allowed: readonly T[], value: unknown, current: T): T {
  return allowed.find((candidate) => candidate === value) ?? current;
}

function nullableString(value: unknown, current: string | null): string | null {
  if (value === null) return null;
  return typeof value === "string" && value !== "" ? value : current;
}

function recent(value: unknown, current: string[]): string[] {
  if (!Array.isArray(value)) return current;
  const unique: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry !== "" && !unique.includes(entry)) unique.push(entry);
  }
  return unique.slice(0, MAX_RECENT);
}

function profileModels(value: unknown, current: Preferences["profileModels"]): Preferences["profileModels"] {
  if (!isRecord(value)) return current;
  const next: Partial<Record<ModelProfile, string>> = {};
  for (const profile of PROFILES) {
    if (!(profile in value)) continue;
    const modelId = value[profile];
    if (typeof modelId === "string" && modelId.trim() !== "") next[profile] = modelId;
    else if (current?.[profile] !== undefined) next[profile] = current[profile];
  }
  return next;
}

/** Older preferences without the flag count as completed when a workspace was already used, so upgrades skip the wizard. */
function onboardingCompleted(patch: Record<string, unknown>, current: boolean): boolean {
  if (typeof patch["onboardingCompleted"] === "boolean") return patch["onboardingCompleted"];
  const last = patch["lastWorkspace"];
  const usedWorkspace =
    (typeof last === "string" && last !== "") ||
    (Array.isArray(patch["recentWorkspaces"]) &&
      patch["recentWorkspaces"].some((entry) => typeof entry === "string" && entry !== ""));
  return usedWorkspace ? true : current;
}

/** Thread ids, deduplicated, newest last, at most MAX_SETTLED entries. */
function threadIds(value: unknown, current: string[]): string[] {
  if (!Array.isArray(value)) return current;
  const unique: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry !== "" && !unique.includes(entry)) unique.push(entry);
  }
  return unique.slice(-MAX_SETTLED);
}

/** Whole days clamped into 1..365; anything that is not a finite number keeps the current value. */
function settleDays(value: unknown, current: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return current;
  return Math.min(MAX_SETTLE_DAYS, Math.max(MIN_SETTLE_DAYS, Math.round(value)));
}

/** Applies every valid field of patch to current; invalid or unknown values keep the current value. */
function merge(current: Preferences, patch: unknown): Preferences {
  if (!isRecord(patch)) return current;
  const has = (key: keyof Preferences): boolean => key in patch;
  return {
    managedThreadIds: Array.isArray(patch["managedThreadIds"])
      ? [...new Set(patch["managedThreadIds"].filter((id): id is string => typeof id === "string" && id !== ""))]
      : current.managedThreadIds,
    threadParents: isRecord(patch["threadParents"])
      ? Object.fromEntries(Object.entries(patch["threadParents"]).filter(([child, parent]) => typeof parent === "string" && child !== parent)) as Record<string, string>
      : current.threadParents,
    threadOrigins: isRecord(patch["threadOrigins"])
      ? Object.fromEntries(Object.entries(patch["threadOrigins"]).filter(([, origin]) => origin === "agent" || origin === "user" || origin === "dori" || origin === "unknown")) as Record<string, ThreadOrigin>
      : current.threadOrigins ?? {},
    threadCreators: isRecord(patch["threadCreators"])
      ? Object.fromEntries(Object.entries(patch["threadCreators"]).flatMap(([id, evidence]) =>
        id !== "" && isRecord(evidence) && evidence["origin"] === "user" && evidence["source"] === "ui-new-session"
          ? [[id, { origin: "user", source: "ui-new-session" }]] : [])) as Record<string, ThreadCreatorEvidence>
      : current.threadCreators ?? {},
    omoAutoUpdate: typeof patch["omoAutoUpdate"] === "boolean" ? patch["omoAutoUpdate"] : current.omoAutoUpdate ?? true,
    theme: has("theme") ? pick(THEMES, patch["theme"], current.theme) : current.theme,
    palette: has("palette") ? pick(PALETTES, patch["palette"], current.palette ?? "omo") : current.palette ?? "omo",
    locale: has("locale") ? pick(LOCALES, patch["locale"], current.locale) : current.locale,
    lastWorkspace: has("lastWorkspace") ? nullableString(patch["lastWorkspace"], current.lastWorkspace) : current.lastWorkspace,
    recentWorkspaces: has("recentWorkspaces") ? recent(patch["recentWorkspaces"], current.recentWorkspaces) : current.recentWorkspaces,
    modelId: has("modelId") ? nullableString(patch["modelId"], current.modelId) : current.modelId,
    onboardingCompleted: onboardingCompleted(patch, current.onboardingCompleted),
    threadNotifications: has("threadNotifications")
      ? pick(THREAD_NOTIFICATION_MODES, patch["threadNotifications"], current.threadNotifications)
      : current.threadNotifications,
    inAppNotifications: typeof patch["inAppNotifications"] === "boolean" ? patch["inAppNotifications"] : current.inAppNotifications,
    timeFormat: has("timeFormat") ? pick(TIME_FORMATS, patch["timeFormat"], current.timeFormat) : current.timeFormat,
    autoSettle: typeof patch["autoSettle"] === "boolean" ? patch["autoSettle"] : current.autoSettle,
    autoSettleDays: has("autoSettleDays") ? settleDays(patch["autoSettleDays"], current.autoSettleDays) : current.autoSettleDays,
    settledThreads: has("settledThreads") ? threadIds(patch["settledThreads"], current.settledThreads) : current.settledThreads,
    unsettledThreads: has("unsettledThreads") ? threadIds(patch["unsettledThreads"], current.unsettledThreads) : current.unsettledThreads,
    ...(has("modelProfile") ? { modelProfile: patch["modelProfile"] === null ? null :
      PROFILES.find(value => value === patch["modelProfile"]) ?? current.modelProfile ?? null }
      : current.modelProfile === undefined ? {} : { modelProfile: current.modelProfile }),
    ...(has("profileModels") ? { profileModels: profileModels(patch["profileModels"], current.profileModels) }
      : current.profileModels === undefined ? {} : { profileModels: current.profileModels }),
  };
}

/** Preferences persisted as <dir>/preferences.json; every write goes through a temp file and rename. */
export class PreferencesStore {
  private readonly file: string;
  private cache: Preferences | null = null;

  constructor(private readonly dir: string) {
    this.file = path.join(dir, "preferences.json");
  }

  get(): Preferences {
    this.cache ??= this.load();
    return this.cache;
  }

  /** Validates patch (which crosses the IPC boundary untyped), persists, and returns the stored preferences. */
  set(patch: unknown): Preferences {
    const next = merge(this.get(), patch);
    mkdirSync(this.dir, { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    renameSync(temp, this.file);
    this.cache = next;
    return next;
  }

  private load(): Preferences {
    let text: string;
    try {
      text = readFileSync(this.file, "utf8");
    } catch (error) {
      // ENOENT on first launch; any other read failure also starts from defaults.
      void error;
      return { ...DEFAULT_PREFERENCES, recentWorkspaces: [] };
    }
    try {
      return merge(DEFAULT_PREFERENCES, JSON.parse(text));
    } catch (error) {
      // A corrupt preferences file is replaced on the next set().
      void error;
      return { ...DEFAULT_PREFERENCES, recentWorkspaces: [] };
    }
  }
}
