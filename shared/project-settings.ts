/** Per-project display settings. The icon and color sets are closed so a stored value always maps to a known glyph and swatch. */
export const PROJECT_ICONS = [
  "folder", "code", "terminal", "globe", "server", "database", "cpu", "bug", "rocket", "flask-conical", "book-open", "bot",
  "brain", "cloud", "package", "wrench", "smartphone", "gamepad-2", "palette", "shield", "zap", "star", "heart", "home",
] as const;
export const PROJECT_COLORS = ["red", "orange", "green", "blue", "violet", "pink"] as const;
export const PROJECT_NAME_MAX = 80;

export type ProjectIcon = (typeof PROJECT_ICONS)[number];
export type ProjectColor = (typeof PROJECT_COLORS)[number];

/** What the user customized for one project directory; every field is optional and absent means today's look. */
export interface ProjectSetting {
  name?: string;
  icon?: string;
  color?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates an untyped projectSettings value: keys are non-empty directory strings, name is trimmed and 1..80
 * characters, icon and color come from the closed sets. Invalid fields are dropped, and so is an entry left empty.
 * A value that is not an object keeps `current`.
 */
export function sanitizeProjectSettings(value: unknown, current: Record<string, ProjectSetting>): Record<string, ProjectSetting> {
  if (!isRecord(value)) return current;
  const next: Record<string, ProjectSetting> = {};
  for (const [cwd, raw] of Object.entries(value)) {
    if (cwd === "" || !isRecord(raw)) continue;
    const setting: ProjectSetting = {};
    const name = typeof raw["name"] === "string" ? raw["name"].trim() : "";
    if (name !== "" && name.length <= PROJECT_NAME_MAX) setting.name = name;
    const icon = PROJECT_ICONS.find((candidate) => candidate === raw["icon"]);
    if (icon !== undefined) setting.icon = icon;
    const color = PROJECT_COLORS.find((candidate) => candidate === raw["color"]);
    if (color !== undefined) setting.color = color;
    if (Object.keys(setting).length > 0) next[cwd] = setting;
  }
  return next;
}
