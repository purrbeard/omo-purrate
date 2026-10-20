/**
 * Pure detection of local file paths inside chat text and inline code. Detection only proposes candidates; whether a
 * candidate really exists is decided later by one batched existence check, so prose that merely looks like a path
 * stays text.
 */
/** One path found in a text, with its span in that text. */
export interface PathCandidate {
  /** Start offset of the displayed text (inclusive). */
  start: number;
  /** End offset of the displayed text (exclusive). */
  end: number;
  /** The displayed text, including any line suffix. */
  text: string;
  /** The path without a `:12` / `:12:5` line suffix; absolute or workspace-relative. */
  path: string;
  /** First line named by the suffix. */
  line?: number;
}

/** Candidates scanned per text, so a pathological message cannot fan out into thousands of lookups. */
export const MAX_CANDIDATES = 60;

const URL_SPANS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]*|\bwww\.[^\s<>"'`]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/giu;
const QUOTED = /(["'\u201c\u2018])((?:[A-Za-z]:[\\/]|\/(?!\/)|\.{1,2}[\\/])[^"'\u201c\u201d\u2018\u2019\n]*?)["'\u201d\u2019]/gu;
const TOKEN = new RegExp(
  "(?<![A-Za-z0-9_@~:/\\\\.-])(?:"
  + "[A-Za-z]:[\\\\/]"
  + "|\\.{1,2}[\\\\/]"
  + "|\\/(?![\\/\\s])"
  + "|[\\p{L}\\p{N}_@~-][\\p{L}\\p{N}_@~.-]*[\\\\/]"
  + "|[\\p{L}\\p{N}_-]+(?:\\.[\\p{L}\\p{N}_-]+)*\\.[A-Za-z][A-Za-z0-9]{0,7}(?![A-Za-z0-9_-])"
  + ")[^\\s\"'<>|*?`\\u0000-\\u001f]*",
  "gu",
);
const TRAILING = /[.,;:!?'"`)\]}>\u3001\u3002\uff0c\uff01\uff1f\u300d\u300f\uff09\u2026]+$/u;
const CJK_TAIL = /^(.*\.[A-Za-z0-9]{1,8})[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u3000-\u303f\u4e00-\u9fff]+$/u;
const LINE_SUFFIX = /:(\d+)(?::(\d+))?$/;

function overlaps(spans: readonly [number, number][], start: number, end: number): boolean {
  return spans.some(([from, to]) => start < to && end > from);
}

function count(value: string, character: string): number {
  return value.split(character).length - 1;
}

/** Remove trailing sentence punctuation, keeping a closing bracket that pairs with one inside the token. */
function trimTrailing(value: string): string {
  let current = value;
  for (;;) {
    const next = current.replace(TRAILING, (run) => {
      let kept = "";
      let rest = run;
      // Keep brackets that balance an opener inside the token: "report (1).png".
      while (rest.length > 0 && ")]}".includes(rest[0] ?? "")) {
        const close = rest[0] ?? "";
        const open = close === ")" ? "(" : close === "]" ? "[" : "{";
        if (count(current.slice(0, current.length - run.length) + kept, open) > count(current.slice(0, current.length - run.length) + kept, close)) {
          kept += close;
          rest = rest.slice(1);
        } else break;
      }
      return kept === "" ? "" : kept;
    });
    if (next === current) return current;
    current = next;
  }
}

function finish(text: string, start: number): PathCandidate | null {
  let shown = trimTrailing(text);
  const cjk = CJK_TAIL.exec(shown);
  if (cjk !== null) shown = trimTrailing(cjk[1] ?? shown);
  if (shown.length < 2 || shown.length > 400) return null;
  let path = shown;
  let line: number | undefined;
  const suffix = LINE_SUFFIX.exec(shown);
  if (suffix !== null && suffix.index > 1) {
    path = shown.slice(0, suffix.index);
    line = Number(suffix[1]);
  }
  if (!/[\p{L}\p{N}]/u.test(path.replace(/^[A-Za-z]:/, ""))) return null;
  return line === undefined ? { start, end: start + shown.length, text: shown, path } : { start, end: start + shown.length, text: shown, path, line };
}

/**
 * Find path candidates in running text: absolute Windows (`C:\\x`, `C:/x`) and POSIX paths, `./` / `../` and
 * separator-bearing relative paths, bare file names with an extension, and quoted paths (which may contain spaces).
 * URLs, e-mail addresses and UNC paths are never matched. Trailing punctuation and a `:12` line suffix are not part of
 * the path.
 * @param text - Plain text (a Markdown text node, a message, a tool output).
 * @returns non-overlapping candidates in text order, at most MAX_CANDIDATES.
 */
export function findPathCandidates(text: string): PathCandidate[] {
  const blocked: [number, number][] = [];
  for (const match of text.matchAll(URL_SPANS)) blocked.push([match.index, match.index + match[0].length]);
  const found: PathCandidate[] = [];
  const taken: [number, number][] = [];
  for (const match of text.matchAll(QUOTED)) {
    const inner = match[2] ?? "";
    const start = match.index + 1;
    if (overlaps(blocked, start, start + inner.length) || /^[\\/]{2}/.test(inner)) continue;
    const candidate = finish(inner.trimEnd(), start);
    if (candidate === null) continue;
    found.push(candidate);
    taken.push([match.index, match.index + match[0].length]);
  }
  for (const match of text.matchAll(TOKEN)) {
    if (overlaps(blocked, match.index, match.index + match[0].length) || overlaps(taken, match.index, match.index + match[0].length)) continue;
    if (/^\\\\/.test(match[0])) continue;
    const candidate = finish(match[0], match.index);
    if (candidate !== null) found.push(candidate);
  }
  found.sort((a, b) => a.start - b.start);
  return found.slice(0, MAX_CANDIDATES);
}

const CODE_PATH_START = /^(?:[A-Za-z]:[\\/]|\/(?!\/)|\.{1,2}[\\/])/;
const CODE_RELATIVE = /^[\p{L}\p{N}_.@~-][^<>|*?"&;$(){}=\n]*[\\/][^<>|*?"&;$(){}=\n]*$/u;

/**
 * The path an inline-code token names, when the whole token is one path (it may contain spaces).
 * @param value - The inline-code text.
 * @returns the candidate spanning the token, or null for commands, URLs and anything that is not a path.
 */
export function inlineCodePath(value: string): PathCandidate | null {
  const trimmed = value.trim().replace(/^(["'])(.*)\1$/u, "$2").trim();
  if (trimmed === "" || trimmed.length > 400 || trimmed.includes("://") || /^[\\/]{2}/.test(trimmed) && !trimmed.startsWith("//")) return null;
  if (trimmed.startsWith("//") || trimmed.startsWith("\\\\")) return null;
  const offset = value.indexOf(trimmed);
  if (CODE_PATH_START.test(trimmed) || CODE_RELATIVE.test(trimmed)) {
    const suffix = LINE_SUFFIX.exec(trimmed);
    const path = suffix !== null && suffix.index > 1 ? trimmed.slice(0, suffix.index) : trimmed;
    const base: PathCandidate = { start: offset, end: offset + trimmed.length, text: trimmed, path };
    return suffix !== null && suffix.index > 1 ? { ...base, line: Number(suffix[1]) } : base;
  }
  const single = findPathCandidates(trimmed);
  const only = single[0];
  return single.length === 1 && only !== undefined && only.start === 0 && only.end === trimmed.length ? { ...only, start: offset, end: offset + trimmed.length } : null;
}

/**
 * Resolve a candidate path against the workspace root.
 * @param path - Absolute or workspace-relative path.
 * @param cwd - Workspace root, when known.
 * @returns an absolute path, or null when the path is relative and no root is known.
 */
export function absolutePathOf(path: string, cwd: string | undefined): string | null {
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/")) return path;
  if (cwd === undefined || cwd === "") return null;
  const separator = /^[A-Za-z]:/.test(cwd) || cwd.includes("\\") ? "\\" : "/";
  const relative = path.replace(/^\.[\\/]/, "");
  if (separator === "\\") return `${cwd.replace(/[\\/]+$/, "")}\\${relative.replace(/\//g, "\\")}`;
  return `${cwd.replace(/[\\/]+$/, "")}${separator}${relative}`;
}
