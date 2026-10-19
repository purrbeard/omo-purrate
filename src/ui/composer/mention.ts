/** The `@query` token under the caret; `end` also covers token characters after the caret. */
export interface MentionTrigger {
  start: number;
  end: number;
  query: string;
}

const QUERY_CHAR = /[^\s@]/;
const WHITESPACE = /\s/;

/**
 * Finds an "@" that starts the text or follows whitespace and runs up to the caret, so e-mail addresses
 * and "a@b" never match.
 */
export function detectMention(text: string, caret: number): MentionTrigger | null {
  let index = caret - 1;
  while (index >= 0 && QUERY_CHAR.test(text.charAt(index))) index--;
  if (index < 0 || text.charAt(index) !== "@") return null;
  if (index > 0 && !WHITESPACE.test(text.charAt(index - 1))) return null;
  let end = caret;
  while (end < text.length && QUERY_CHAR.test(text.charAt(end))) end++;
  return { start: index, end, query: text.slice(index + 1, caret) };
}

/** The draft without the `@query` token (a space left on both sides collapses to one); the caret lands where it stood. */
export function removeMention(text: string, trigger: MentionTrigger): { text: string; caret: number } {
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.end);
  const joined = WHITESPACE.test(before.slice(-1)) && WHITESPACE.test(after.charAt(0)) ? before + after.slice(1) : before + after;
  return { text: joined, caret: before.length };
}
