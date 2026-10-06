/**
 * Column geometry ported from DSH ui-layout/columns.ts for the tracks sidebar | center | side chat panel: the right
 * column shrinks, then loses its track, before the center drops below its minimum.
 */

export interface Columns {
  sidebar: number;
  center: number;
  rightbar: number;
}

export const CENTER_MIN = 400;
export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 420;
export const SIDEBAR_DEFAULT = 280;
export const RIGHTBAR_MIN = 300;
export const RIGHTBAR_MAX_RATIO = 0.7;
export const TOP_STRIP_HEIGHT = 52;

export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)));
}

/**
 * Solves the column widths for one viewport.
 * @param viewport available frame width in px
 * @param sidebar sidebar preference in px; 0 hides the column entirely
 * @param rightbar requested right panel width in px; 0 means no track
 */
export function computeColumns(viewport: number, sidebar: number, rightbar: number): Columns {
  const s = sidebar === 0 ? 0 : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX);
  const available = viewport - s - CENTER_MIN;
  const r =
    rightbar === 0 || available < RIGHTBAR_MIN
      ? 0
      : Math.min(available, clampWidth(rightbar, RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO));
  return { sidebar: s, center: Math.max(0, viewport - s - r), rightbar: r };
}
