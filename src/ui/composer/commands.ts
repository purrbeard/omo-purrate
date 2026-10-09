import type { SkillMetadata } from "../../../shared/protocol";
import type { NativeCommand } from "../../../shared/workbench";
import type { MessageKey } from "../../i18n";
import type { SkillTrigger } from "./skill-draft";

/** A "/" command OmO UI handles itself instead of sending it to omo. */
export interface ComposerCommand {
  name: string;
  aliases: readonly string[];
  description: MessageKey;
  source?: "builtin" | "extension" | "prompt";
  nativeDescription?: string;
}

/** `/btw` (alias `/side`) asks a side question; `parseBtwCommand` in src/state/btw.ts reads it at send time. */
export const COMPOSER_COMMANDS: readonly ComposerCommand[] = [
  { name: "btw", aliases: ["side"], description: "btw.command.description" },
  { name: "compact", aliases: [], description: "composer.commands.compact" },
  { name: "goal", aliases: [], description: "composer.commands.goal" },
  { name: "model", aliases: [], description: "composer.commands.model" },
  { name: "plan", aliases: [], description: "composer.commands.plan" },
];

export type MenuOption = { kind: "command"; command: ComposerCommand } | { kind: "skill"; skill: SkillMetadata };

/** @returns the commands whose name or an alias starts with the typed query (any letter case); an empty query lists all */
export function matchCommands(query: string, native: readonly NativeCommand[] = []): ComposerCommand[] {
  const typed = query.toLowerCase();
  const extensions: ComposerCommand[] = native.filter(command => command.source !== "skill" && command.syntax === "slash")
    .filter(command => !COMPOSER_COMMANDS.some(builtin => builtin.name === command.name || builtin.aliases.includes(command.name)))
    .map(command => ({ name: command.name, aliases: [], description: "composer.commands.extension", source: command.source as "extension" | "prompt", nativeDescription: command.description }));
  return [...COMPOSER_COMMANDS, ...extensions].filter(
    (command) => command.name.toLowerCase().startsWith(typed) || command.aliases.some((alias) => alias.startsWith(typed)),
  );
}

/** Native skill metadata is a fallback only; skills/list remains authoritative. */
export function nativeSkills(commands: readonly NativeCommand[]): SkillMetadata[] {
  return commands.filter(command => command.source === "skill").map(command => ({
    name: command.name.replace(/^skill:/, ""), description: command.description,
    path: `native:${command.name}`, scope: "system", enabled: true,
  }));
}

/** @returns the "/" menu rows: skills first for a bare "/", commands first once the typed query matches one */
export function menuOptions(commands: readonly ComposerCommand[], skills: readonly SkillMetadata[], query: string): MenuOption[] {
  const commandOptions = commands.map((command): MenuOption => ({ kind: "command", command }));
  const skillOptions = skills.map((skill): MenuOption => ({ kind: "skill", skill }));
  return query === "" ? [...skillOptions, ...commandOptions] : [...commandOptions, ...skillOptions];
}

export function acceptCommand(text: string, trigger: SkillTrigger, name: string): { text: string; caret: number } {
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.end);
  const inserted = `/${name} `;
  return { text: before + inserted + (after.startsWith(" ") ? after.slice(1) : after), caret: before.length + inserted.length };
}
