import { describe, expect, it } from "vitest";
import { contrastMix } from "../../src/ui/appearance";

describe("contrastMix", () => {
  it("leaves the palette alone at 100", () => {
    expect(contrastMix(100)).toBeNull();
  });

  it("moves toward the foreground above 100 and the background below", () => {
    expect(contrastMix(150)).toEqual({ mix: 40, target: "foreground" });
    expect(contrastMix(80)).toEqual({ mix: 24, target: "background" });
  });
});
