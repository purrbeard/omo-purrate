/** omo magic keywords that switch the composer into its gradient state. */
export const MAGIC_KEYWORDS = ["ulw", "ultrawork", "ulw-loop"] as const;
export type MagicKeyword = (typeof MAGIC_KEYWORDS)[number];

export interface KeywordMatch {
  keyword: MagicKeyword;
  /** The keyword as typed (case preserved). */
  text: string;
  start: number;
  end: number;
}

/**
 * A keyword counts only as a whole word: letters, digits, `_`, `-` and `/` on either side disqualify it (`ulwx`, `xulw`,
 * `mass-ulw`). `ulw-loop` also matches as the `/ulw-loop` skill command, the slash included in the match.
 */
const KEYWORD_PATTERN = /(^|[^\w\-/])(\/?ulw-loop|ulw|ultrawork)(?![\w\-/])/gi;

function keywordOf(word: string): MagicKeyword {
  const lower = word.toLowerCase();
  return lower === "ulw" ? "ulw" : lower === "ultrawork" ? "ultrawork" : "ulw-loop";
}

/** Every whole-word magic keyword in `text`, in order. */
export function findMagicKeywords(text: string): KeywordMatch[] {
  const matches: KeywordMatch[] = [];
  for (const match of text.matchAll(KEYWORD_PATTERN)) {
    const lead = match[1] ?? "";
    const word = match[2] ?? "";
    const start = match.index + lead.length;
    matches.push({ keyword: keywordOf(word), text: word, start, end: start + word.length });
  }
  return matches;
}

/** The first magic keyword in `text`, or null. */
export function detectMagicKeyword(text: string): KeywordMatch | null {
  return findMagicKeywords(text)[0] ?? null;
}

export type DraftSegment = { kind: "text"; text: string } | { kind: "keyword"; text: string };

/** Splits `text` into plain and keyword segments for the composer's mirror layer. */
export function segmentDraft(text: string): DraftSegment[] {
  const segments: DraftSegment[] = [];
  let cursor = 0;
  for (const match of findMagicKeywords(text)) {
    if (match.start > cursor) segments.push({ kind: "text", text: text.slice(cursor, match.start) });
    segments.push({ kind: "keyword", text: match.text });
    cursor = match.end;
  }
  if (cursor < text.length || segments.length === 0) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments;
}
