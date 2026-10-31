/** Pure detection proposes path candidates; the batched existence check decides which become clickable. */
export interface PathCandidate {
  start: number;
  end: number;
  text: string;
  path: string;
  line?: number;
}

export const MAX_CANDIDATES = 60;

const URL_SPANS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]*|\bwww\.[^\s<>"'`]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/giu;
const QUOTED = /(["'`\u201c\u2018])((?:[A-Za-z]:[\\/]|\/(?!\/)|\.{1,2}[\\/])[^"'`\u201c\u201d\u2018\u2019\n]*?)["'`\u201d\u2019]/gu;
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

/** Keep closing brackets that balance an opener inside the path. */
function trimTrailing(value: string): string {
  let current = value;
  for (;;) {
    const next = current.replace(TRAILING, (run) => {
      let kept = "";
      let rest = run;
      while (rest.length > 0 && ")]}".includes(rest[0] ?? "")) {
        const close = rest[0] ?? "";
        const open = close === ")" ? "(" : close === "]" ? "[" : "{";
        if (count(current.slice(0, current.length - run.length) + kept, open) > count(current.slice(0, current.length - run.length) + kept, close)) {
          kept += close;
          rest = rest.slice(1);
        } else break;
      }
      return kept;
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

/** Find bounded, non-overlapping local paths, excluding URLs, email and UNC paths. */
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

/** Resolve a whole inline-code path without changing its displayed value. */
export function inlineCodePath(value: string): PathCandidate | null {
  const trimmed = value.trim().replace(/^(["'])(.*)\1$/u, "$2").trim();
  if (trimmed === "" || trimmed.length > 400 || trimmed.includes("://") || /^[\\/]{2}/.test(trimmed)) return null;
  if (CODE_PATH_START.test(trimmed) || CODE_RELATIVE.test(trimmed)) {
    const suffix = LINE_SUFFIX.exec(trimmed);
    const path = suffix !== null && suffix.index > 1 ? trimmed.slice(0, suffix.index) : trimmed;
    const base: PathCandidate = { start: 0, end: value.length, text: value, path };
    return suffix !== null && suffix.index > 1 ? { ...base, line: Number(suffix[1]) } : base;
  }
  const single = findPathCandidates(trimmed);
  const only = single[0];
  return single.length === 1 && only !== undefined && only.start === 0 && only.end === trimmed.length
    ? { ...only, start: 0, end: value.length, text: value } : null;
}

/** Resolve a workspace-relative candidate, preserving already absolute paths. */
export function absolutePathOf(path: string, cwd: string | undefined): string | null {
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/")) return path;
  if (cwd === undefined || cwd === "") return null;
  const separator = /^[A-Za-z]:/.test(cwd) || cwd.includes("\\") ? "\\" : "/";
  const relative = path.replace(/^\.[\\/]/, "");
  if (separator === "\\") return `${cwd.replace(/[\\/]+$/, "")}\\${relative.replace(/\//g, "\\")}`;
  return `${cwd.replace(/[\\/]+$/, "")}${separator}${relative}`;
}
