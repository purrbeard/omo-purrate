/**
 * omo magic keywords, matched with the same rules omo 5.1.35 uses to arm its skill pointers
 * (plugin/extensions/omo.js: the `qde` word guards, the `zde` mass-ulw spelling set and the `jde`/`Mde`
 * masking), so the composer highlights exactly the words omo will react to. The one addition is the
 * slash form (`/ulw-loop`, `/mass-ulw`), which loads the same skill through the slash menu.
 */
export const MAGIC_KEYWORDS = ["ulw", "ultrawork", "mass-ulw", "ulw-plan", "ulw-loop", "ulw-research"] as const;
export type MagicKeyword = (typeof MAGIC_KEYWORDS)[number];

/** One hint line per group; `ulw` and `ultrawork` are the same mode. */
export type MagicKeywordHint = "ulw" | "mass-ulw" | "ulw-plan" | "ulw-loop" | "ulw-research";

export interface KeywordMatch {
  keyword: MagicKeyword;
  /** The keyword as typed (case preserved). */
  text: string;
  start: number;
  end: number;
}

/** Not glued to a preceding word by `-`/`_`/`.`, and not part of a path. */
const LEAD = String.raw`(?<![A-Za-z0-9][-_.]|[/\\])`;
/** A slash command: the slash itself must stand alone. */
const SLASH_LEAD = String.raw`(?<![\w\-./\\])\/`;
const WORD_END = String.raw`(?![-_.]?[A-Za-z0-9])`;
/** `ulw-loop`, `ulw-plan`... still count as `ulw`; any other glued suffix does not. */
const TAIL = String.raw`(?![-_](?!(?:loop|plan|research|execute|mass)${WORD_END})[A-Za-z0-9]|\.[A-Za-z0-9])`;
const NOT_PATH = String.raw`(?![-_.]?[A-Za-z0-9]*[/\\])`;
const MASS = String.raw`(?:mass[\s-]*ulw|ulw[\s-]*mass|mulw|meth)`;

const guarded = (body: string): RegExp => new RegExp(String.raw`(?:${SLASH_LEAD}|${LEAD})\b(?:${body})\b${TAIL}${NOT_PATH}`, "gi");

const PATTERNS: ReadonlyArray<{ keyword: MagicKeyword | "ulw-family"; pattern: RegExp }> = [
  { keyword: "mass-ulw", pattern: guarded(MASS) },
  { keyword: "ulw-plan", pattern: guarded(String.raw`ulw[\s-]*plan`) },
  { keyword: "ulw-loop", pattern: guarded(String.raw`ulw[\s-]*loop`) },
  { keyword: "ulw-research", pattern: guarded(String.raw`(?:ulw|${MASS})[\s-]*research`) },
  { keyword: "ulw-family", pattern: guarded("ultrawork|ulw") },
];

const blank = (text: string): string => text.replace(/[^\r\n]/g, "\0");
/** Relayed lines (`[TAG] ...`, `Name (id), to x:`) are not the person's own instruction. */
const RELAYED = /^\s*(?:\[(?:[A-Z][A-Z0-9_-]{2,}|[\w.-]+ -> [\w.-]+)\]|[A-Z][\w.-]{0,30} \([^()\s]{1,40}\)(?:, | to )[\w.-]{1,40}:)/;
const INLINE_CODE = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
const BLOCKQUOTE = /^ {0,3}>[^\n]*/gm;
const QUOTED = /"[^"\n]*"|\u201C[^\u201D\n]*\u201D/g;
const URL = /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi;
const NEGATED = /\b(?:do\s+not|don['\u2019]t|dont|never)\s+(?:load|use|run|invoke|start|trigger|arm|enable)\b[^.;:!?\n]*?(?=[.;:!?\n]|\s(?:but|then|instead|however)\b|\s[\u2014\u2013-]\s|$)/gi;

/** Blanks (length-preserving) every span omo ignores: code, quotes, URLs, blockquotes and "do not use ..." phrases. */
export function maskIgnoredSpans(text: string): string {
  if (RELAYED.test(text)) return blank(text);
  let masked = text;
  const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/gm;
  for (let open = fence.exec(masked); open !== null; open = fence.exec(masked)) {
    const marker = open[1] ?? "```";
    const close = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*\\r?$`, "gm");
    close.lastIndex = fence.lastIndex;
    const end = close.exec(masked) === null ? masked.length : close.lastIndex;
    masked = masked.slice(0, open.index) + blank(masked.slice(open.index, end)) + masked.slice(end);
    fence.lastIndex = end;
  }
  return masked.replace(INLINE_CODE, blank).replace(BLOCKQUOTE, blank).replace(QUOTED, blank).replace(URL, blank).replace(NEGATED, blank);
}

/**
 * Every magic keyword in `text`, ordered by start (longer first on a tie). Different keywords may overlap
 * (`mass ulw research` is both `ulw-research` and `mass-ulw`); a bare `ulw`/`ultrawork` inside another keyword is dropped.
 */
export function findMagicKeywords(text: string): KeywordMatch[] {
  const masked = maskIgnoredSpans(text);
  const found: KeywordMatch[] = [];
  for (const { keyword, pattern } of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of masked.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      const typed = text.slice(start, end);
      const id: MagicKeyword = keyword !== "ulw-family" ? keyword : typed.replace(/^\//, "").toLowerCase() === "ultrawork" ? "ultrawork" : "ulw";
      found.push({ keyword: id, text: typed, start, end });
    }
  }
  const bare = (match: KeywordMatch): boolean => match.keyword === "ulw" || match.keyword === "ultrawork";
  return found
    .filter((match) => !bare(match) || !found.some((other) => !bare(other) && other.start <= match.start && other.end >= match.end))
    .sort((a, b) => a.start - b.start || b.end - a.end);
}

/** The first magic keyword in `text`, or null. */
export function detectMagicKeyword(text: string): KeywordMatch | null {
  return findMagicKeywords(text)[0] ?? null;
}

export function hintOf(keyword: MagicKeyword): MagicKeywordHint {
  return keyword === "ultrawork" ? "ulw" : keyword;
}

/** The hint lines for `matches`, one per group, in match order. */
export function keywordHints(matches: readonly KeywordMatch[]): MagicKeywordHint[] {
  return [...new Set(matches.map((match) => hintOf(match.keyword)))];
}

export type DraftSegment = { kind: "text"; text: string } | { kind: "keyword"; text: string };

/** Splits `text` into plain and keyword segments for the composer's mirror layer; overlapping keywords form one segment. */
export function segmentDraft(text: string): DraftSegment[] {
  const segments: DraftSegment[] = [];
  let cursor = 0;
  let open: { start: number; end: number } | null = null;
  const flush = (): void => {
    if (open === null) return;
    if (open.start > cursor) segments.push({ kind: "text", text: text.slice(cursor, open.start) });
    segments.push({ kind: "keyword", text: text.slice(open.start, open.end) });
    cursor = open.end;
    open = null;
  };
  for (const match of findMagicKeywords(text)) {
    if (open !== null && match.start < open.end) open.end = Math.max(open.end, match.end);
    else {
      flush();
      open = { start: match.start, end: match.end };
    }
  }
  flush();
  if (cursor < text.length || segments.length === 0) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments;
}
