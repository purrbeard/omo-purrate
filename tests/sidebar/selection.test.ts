import { describe, expect, it } from "vitest";
import { pruneSelection, selectRange, toggleId } from "../../src/ui/sidebar/selection";

const order = ["a", "b", "c", "d", "e"];

describe("selection", () => {
  it("toggles one id without mutating the input", () => {
    const start = new Set(["a"]);
    expect([...toggleId(start, "b")]).toEqual(["a", "b"]);
    expect([...toggleId(start, "a")]).toEqual([]);
    expect([...start]).toEqual(["a"]);
  });

  it("selects the visible range from the anchor in either direction and keeps the existing selection", () => {
    expect([...selectRange(order, "b", "d", new Set())]).toEqual(["b", "c", "d"]);
    expect([...selectRange(order, "d", "b", new Set())].sort()).toEqual(["b", "c", "d"]);
    expect([...selectRange(order, "b", "c", new Set(["e"]))].sort()).toEqual(["b", "c", "e"]);
  });

  it("selects only the clicked row when the anchor is missing or no longer visible", () => {
    expect([...selectRange(order, null, "c", new Set())]).toEqual(["c"]);
    expect([...selectRange(order, "gone", "c", new Set())]).toEqual(["c"]);
    expect([...selectRange(order, "a", "hidden", new Set(["a"]))]).toEqual(["a"]);
  });

  it("prunes vanished threads and returns the same set when nothing vanished", () => {
    const selected = new Set(["a", "b"]);
    expect(pruneSelection(selected, new Set(["a", "b", "c"]))).toBe(selected);
    expect([...pruneSelection(selected, new Set(["b"]))]).toEqual(["b"]);
  });
});
