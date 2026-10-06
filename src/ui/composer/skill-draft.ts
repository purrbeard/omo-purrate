import type { SkillMetadata } from "../../../shared/protocol";
import { rankByName } from "../../dsh/primitives/rank-by-name";

/** omo expands at most this many distinct leading `/skill:` tokens per message. */
export const MAX_SKILLS_PER_MESSAGE = 5;

const QUERY_CHAR = /[A-Za-z0-9:_-]/;
const WHITESPACE = /\s/;
const SKILL_PREFIX = "skill:";

/** The `/query` token under the caret; `end` also covers token characters after the caret. */
export interface SkillTrigger {
  start: number;
  end: number;
  query: string;
}

export interface SkillDraft {
  text: string;
  /** Names picked from the menu, in selection order. */
  selected: string[];
}

export type AcceptSkillResult = { ok: true; draft: SkillDraft; caret: number } | { ok: false; reason: "limit" };

/**
 * Finds a "/" token that starts the text or follows whitespace and runs up to the caret.
 * Slashes inside words, paths, URLs and `//` never match.
 */
export function detectSkillTrigger(text: string, caret: number): SkillTrigger | null {
  let index = caret - 1;
  while (index >= 0 && QUERY_CHAR.test(text.charAt(index))) index--;
  if (index < 0 || text.charAt(index) !== "/") return null;
  if (index > 0 && !WHITESPACE.test(text.charAt(index - 1))) return null;
  let end = caret;
  while (end < text.length && QUERY_CHAR.test(text.charAt(end))) end++;
  return { start: index, end, query: text.slice(index + 1, caret) };
}

export function skillSummary(skill: SkillMetadata): string {
  const candidates = [skill.interface?.shortDescription, skill.shortDescription, skill.description];
  return candidates.find((candidate) => candidate !== undefined && candidate.trim() !== "") ?? "";
}

/** Ranks skills by name and display name; a typed `skill:` prefix is ignored. */
export function rankSkills(skills: readonly SkillMetadata[], query: string): SkillMetadata[] {
  const bare = query.toLowerCase().startsWith(SKILL_PREFIX) ? query.slice(SKILL_PREFIX.length) : query;
  const rows = skills.map((skill) => {
    const label = skill.interface?.displayName;
    return label === undefined ? { name: skill.name, skill } : { name: skill.name, label, skill };
  });
  return rankByName(rows, bare).map((row) => row.skill);
}

function hasToken(text: string, name: string): boolean {
  return text.split(/\s+/).includes(`/${name}`);
}

/** Drops duplicate names and names whose `/name` token no longer appears as a whole token. */
export function pruneSelected(text: string, selected: readonly string[]): string[] {
  return selected.filter((name, index) => selected.indexOf(name) === index && hasToken(text, name));
}

/**
 * Replaces the trigger span with `/name ` and records the selection. Refuses when the draft
 * would then hold more than {@link MAX_SKILLS_PER_MESSAGE} distinct skills.
 */
export function acceptSkill(draft: SkillDraft, trigger: SkillTrigger, name: string): AcceptSkillResult {
  const before = draft.text.slice(0, trigger.start);
  const after = draft.text.slice(trigger.end);
  const inserted = `/${name} `;
  const text = before + inserted + (after.startsWith(" ") ? after.slice(1) : after);
  const selected = pruneSelected(text, [...draft.selected, name]);
  if (selected.length > MAX_SKILLS_PER_MESSAGE) return { ok: false, reason: "limit" };
  return { ok: true, draft: { text, selected }, caret: before.length + inserted.length };
}

/**
 * Builds the transport text: selected skills become the leading `/skill:` run in selection
 * order, followed by the text with those tokens removed. Text without selections is unchanged.
 */
export function serializeSkillDraft(draft: SkillDraft): string {
  const names = pruneSelected(draft.text, draft.selected).slice(0, MAX_SKILLS_PER_MESSAGE);
  if (names.length === 0) return draft.text;
  const tokens = new Set(names.map((name) => `/${name}`));
  const parts = draft.text.split(/(\s+)/);
  const kept: string[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const token = parts[index] ?? "";
    const space = parts[index + 1] ?? "";
    if (!tokens.has(token)) {
      kept.push(token, space);
      continue;
    }
    if (!space.includes("\n")) continue;
    const previous = kept.pop();
    if (previous !== undefined) kept.push(previous.replace(/[ \t]+$/, ""));
    kept.push(space);
  }
  const rest = kept.join("").trim();
  const run = names.map((name) => `/skill:${name}`).join(" ");
  return rest === "" ? run : `${run} ${rest}`;
}
