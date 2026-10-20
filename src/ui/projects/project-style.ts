import { Bot, BookOpen, Brain, Bug, Cloud, Code, Cpu, Database, Folder, FlaskConical, Gamepad2, Globe, Heart, House, Package, Palette, Rocket, Server, Shield, Smartphone, Star, Terminal, Wrench, Zap, type LucideIcon } from "lucide-react";
import type { ProjectColor, ProjectIcon, ProjectSetting } from "../../../shared/project-settings";
import { projectKey } from "./project-list";

export const PROJECT_ICON_COMPONENTS: Record<ProjectIcon, LucideIcon> = {
  folder: Folder, code: Code, terminal: Terminal, globe: Globe, server: Server, database: Database, cpu: Cpu, bug: Bug,
  rocket: Rocket, "flask-conical": FlaskConical, "book-open": BookOpen, bot: Bot, brain: Brain, cloud: Cloud, package: Package,
  wrench: Wrench, smartphone: Smartphone, "gamepad-2": Gamepad2, palette: Palette, shield: Shield, zap: Zap, star: Star,
  heart: Heart, home: House,
};

/** Hue of each swatch; saturation and lightness are shared so every swatch reads on light and dark surfaces. */
export const PROJECT_COLOR_HUES: Record<ProjectColor, number> = { red: 2, orange: 28, green: 145, blue: 214, violet: 265, pink: 330 };

/** Fill and ink of a project badge for one swatch. */
export function projectColorStyle(color: ProjectColor): { backgroundColor: string; color: string } {
  const hue = PROJECT_COLOR_HUES[color];
  return { backgroundColor: `hsl(${hue} 70% 50% / 0.2)`, color: `hsl(${hue} 70% 48%)` };
}

/** The customized settings of the project at `cwd`, matching it the way the project list does (separator and case tolerant). */
export function findProjectSetting(settings: Readonly<Record<string, ProjectSetting>> | undefined, cwd: string): { key: string; setting: ProjectSetting } | null {
  if (settings === undefined) return null;
  const wanted = projectKey(cwd);
  for (const [key, setting] of Object.entries(settings)) if (projectKey(key) === wanted) return { key, setting };
  return null;
}

/** The last path segment of a directory, or the whole path when it has none. */
export function folderName(cwd: string): string {
  return cwd.split(/[\\/]/).filter((segment) => segment.length > 0).at(-1) ?? cwd;
}

/** The name shown for a project: the user's display name, else the folder name. */
export function projectDisplayName(settings: Readonly<Record<string, ProjectSetting>> | undefined, cwd: string): string {
  return findProjectSetting(settings, cwd)?.setting.name ?? folderName(cwd);
}

/**
 * The record after applying `patch` to the project at `cwd`: a field set to undefined is cleared, and a project left
 * with no field is dropped. The entry keeps the key it already has, so one directory never gets two entries.
 */
export function patchProjectSetting(settings: Readonly<Record<string, ProjectSetting>> | undefined, cwd: string, patch: { [K in keyof ProjectSetting]: ProjectSetting[K] | undefined }): Record<string, ProjectSetting> {
  const found = findProjectSetting(settings, cwd);
  const key = found?.key ?? cwd;
  const merged: ProjectSetting = { ...found?.setting };
  for (const field of ["name", "icon", "color"] as const) {
    if (!(field in patch)) continue;
    const value = patch[field];
    if (value === undefined) delete merged[field];
    else merged[field] = value;
  }
  const next = { ...settings };
  delete next[key];
  if (Object.keys(merged).length > 0) next[key] = merged;
  return next;
}
