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
