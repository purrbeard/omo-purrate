import { describe, expect, it } from "vitest";
import { themeRevealGeometry } from "../src/ui/theme-reveal";

describe("themeRevealGeometry", () => {
  it("uses the control centre, not its click position", () => {
    expect(themeRevealGeometry({ left: 40, top: 20, width: 20, height: 60 }, { width: 100, height: 100 }))
      .toEqual({ x: 50, y: 50, radius: Math.hypot(50, 50) });
  });
  it.each([
    [0, 0], [980, 0], [0, 780], [980, 780], [231.5, 147.25],
  ])("reaches every corner from (%s, %s)", (left, top) => {
    const { x, y, radius } = themeRevealGeometry({ left, top, width: 20, height: 20 }, { width: 1000, height: 800 });
    const distances = [[0, 0], [1000, 0], [0, 800], [1000, 800]]
      .map(([cx = 0, cy = 0]) => Math.hypot(cx - x, cy - y));
    expect(radius).toBe(Math.max(...distances));
  });
});
