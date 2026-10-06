import type { SkillMetadata } from "../../../shared/protocol";
import type { MessageKey } from "../../i18n";
import type { SkillTrigger } from "./skill-draft";

/** A "/" command OmO UI handles itself instead of sending it to omo. */
export interface ComposerCommand {
  name: string;
  aliases: readonly string[];
  description: MessageKey;
}

/** `/btw` (alias `/side`) asks a side question; `parseBtwCommand` in src/state/btw.ts reads it at send time. */
export const COMPOSER_COMMANDS: readonly ComposerCommand[] = [
  { name: "btw", aliases: ["side"], description: "btw.command.description" },
];

export type MenuOption = { kind: "command"; command: ComposerCommand } | { kind: "skill"; skill: SkillMetadata };

/** @returns the commands whose name or an alias starts with the typed query (any letter case); an empty query lists all */
export function matchCommands(query: string): ComposerCommand[] {
  const typed = query.toLowerCase();
  return COMPOSER_COMMANDS.filter(
    (command) => command.name.startsWith(typed) || command.aliases.some((alias) => alias.startsWith(typed)),
  );
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
