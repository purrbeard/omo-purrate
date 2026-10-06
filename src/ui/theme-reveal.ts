export function themeRevealGeometry(
  rect: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number; radius: number } {
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const radius = Math.hypot(Math.max(x, viewport.width - x), Math.max(y, viewport.height - y));
  return { x, y, radius };
}
