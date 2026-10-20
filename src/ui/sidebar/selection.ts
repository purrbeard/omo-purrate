/** Selection toggling for the sidebar's multi-select; pure so the range rules are testable. */

/** Adds or removes one id. */
export function toggleId(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * Adds the visible ids between `anchor` and `id` (both included, either direction) to the selection. Without a
 * usable anchor (none, or no longer visible) it selects just `id`.
 */
export function selectRange(order: readonly string[], anchor: string | null, id: string, selected: ReadonlySet<string>): Set<string> {
  const to = order.indexOf(id);
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const next = new Set(selected);
  if (to === -1) return next;
  if (from === -1) {
    next.add(id);
    return next;
  }
  for (const entry of order.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(entry);
  return next;
}

/** Drops ids that no longer exist; returns the same set when nothing changed. */
export function pruneSelection(selected: ReadonlySet<string>, existing: ReadonlySet<string>): ReadonlySet<string> {
  let changed = false;
  const next = new Set<string>();
  for (const id of selected) {
    if (existing.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : selected;
}
