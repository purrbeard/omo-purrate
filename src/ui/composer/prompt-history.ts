import type { ConversationTurn } from "../../state";
import { resendOf } from "../conversation/resend";
import { splitContext } from "./context-draft";
import type { SkillDraft } from "./skill-draft";

export interface HistoryCursor {
  readonly entries: readonly string[];
  readonly index: number;
  readonly original: SkillDraft;
}

/** History outlines preserve user messages whole, including long prompts. */
export function promptHistory(turns: readonly ConversationTurn[]): string[] {
  return turns.flatMap(turn => turn.items.flatMap(({ item }) => {
    if (item.type !== "userMessage") return [];
    const text = splitContext(resendOf(item.content).text).text;
    return text.trim() === "" ? [] : [text];
  }));
}

export function recallPrompt(cursor: HistoryCursor, direction: "up" | "down"): { cursor: HistoryCursor | null; draft: SkillDraft } | null {
  const index = Math.max(0, Math.min(cursor.entries.length, cursor.index + (direction === "up" ? -1 : 1)));
  if (index === cursor.index) return null;
  if (index === cursor.entries.length) return { cursor: null, draft: cursor.original };
  const text = cursor.entries[index];
  return text === undefined ? null : { cursor: { ...cursor, index }, draft: { text, selected: [] } };
}
