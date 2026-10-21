import { describe, expect, it } from "vitest";
import { itemAtPointer, previewText, tickPercent } from "../../src/ui/conversation/timeline-position";

describe("timeline preview text", () => {
  it("shows an answer's markdown as plain text", () => {
    expect(previewText("## Summary\n\n- **Fixed** the `parser` in [notes](https://x.test/a)\n> quoted\n1. one ~~two~~"))
      .toBe("Summary Fixed the parser in notes quoted one two");
  });

  it("leaves code blocks' content and drops their fences and images", () => {
    expect(previewText("Run:\n```bash\nnpm test\n```\n![shot](a.png) done __now__")).toBe("Run: npm test done now");
  });
});

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
