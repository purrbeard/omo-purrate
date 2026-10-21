import { describe, expect, it } from "vitest";
import { itemAtPointer, tickPercent } from "../../src/ui/conversation/timeline-position";

describe("timeline rail positions", () => {
  it("spreads ticks from the top to the bottom edge", () => {
    expect(tickPercent(0, 5)).toBe(0);
    expect(tickPercent(2, 5)).toBe(50);
    expect(tickPercent(4, 5)).toBe(100);
    expect(tickPercent(0, 1)).toBe(0);
  });

  it("maps a pointer to the nearest item and clamps outside the rail", () => {
    expect(itemAtPointer(5, 100, 400, 100)).toBe(0);
    expect(itemAtPointer(5, 100, 400, 290)).toBe(2);
    expect(itemAtPointer(5, 100, 400, 520)).toBe(4);
    expect(itemAtPointer(5, 100, 400, 40)).toBe(0);
    expect(itemAtPointer(0, 100, 400, 200)).toBeNull();
  });
});
