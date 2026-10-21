/** One line of plain text from markdown, for the preview card: syntax marks dropped, link and code text kept. */
export function previewText(markdown: string): string {
  return markdown
    .replace(/^\s*```.*$/gmu, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gmu, "")
    .replace(/(\*\*|__|~~|\*|_|`)(\S(?:.*?\S)?)\1/gu, "$2")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Percent offset of item `index` along a rail of `count` items. */
export function tickPercent(index: number, count: number): number {
  return count <= 1 ? 0 : (Math.max(0, Math.min(index, count - 1)) / (count - 1)) * 100;
}

/** The item a pointer at `pointerY` points to on a rail spanning `railTop`..`railTop + railHeight`. */
export function itemAtPointer(count: number, railTop: number, railHeight: number, pointerY: number): number | null {
  if (count <= 0 || railHeight <= 0) return null;
  const ratio = Math.max(0, Math.min(1, (pointerY - railTop) / railHeight));
  return Math.round(ratio * (count - 1));
}
