import { describe, expect, it } from "vitest";
import { activateTerminal, addTerminal, initialTerminals, parseTerminalLayout, removeTerminal, splitTerminal, terminalIds } from "../../src/ui/terminal/terminal-layout";

describe("terminal layout", () => {
  it("splits into the active group and opens new terminals in groups of their own", () => {
    // Given
    const start = initialTerminals();
    // When
    const split = splitTerminal(start, "horizontal");
    const stacked = splitTerminal(addTerminal(split), "vertical");
    // Then
    expect(split.groups).toEqual([{ id: "g1", terminalIds: ["t1", "t2"], splitDirection: "horizontal", sizes: [1, 1] }]);
    expect(split.activeTerminalId).toBe("t2");
    expect(stacked.groups.map(group => [group.terminalIds, group.splitDirection])).toEqual([[["t1", "t2"], "horizontal"], [["t3", "t4"], "vertical"]]);
    expect(stacked).toMatchObject({ activeTerminalId: "t4", activeGroupId: "g3" });
    expect(activateTerminal(stacked, "t1")).toMatchObject({ activeTerminalId: "t1", activeGroupId: "g1" });
  });
  it("closes into the neighbor pane, drops empty groups and numbers past the highest id", () => {
    // Given
    const layout = addTerminal(splitTerminal(initialTerminals(), "horizontal"));
    // When
    const withoutSecond = removeTerminal(activateTerminal(layout, "t2"), "t2");
    const withoutGroup = removeTerminal(layout, "t3");
    // Then
    expect(withoutSecond).toMatchObject({ activeTerminalId: "t1", activeGroupId: "g1" });
    expect(withoutSecond?.groups[0]).toMatchObject({ terminalIds: ["t1"], sizes: [1] });
    expect(withoutGroup?.groups.map(group => group.id)).toEqual(["g1"]);
    expect(withoutGroup?.activeTerminalId).toBe("t1");
    expect(terminalIds(addTerminal(withoutSecond!))).toEqual(["t1", "t3", "t4"]);
    expect(removeTerminal(initialTerminals(), "t1")).toBeNull();
  });
  it("restores a stored layout and falls back on malformed data", () => {
    // Given
    const stored = { placement: "side", threads: { a: splitTerminal(initialTerminals(), "vertical"), b: { groups: "x" } } };
    // When
    const parsed = parseTerminalLayout(JSON.stringify(stored));
    // Then
    expect(parsed.placement).toBe("side");
    expect(Object.keys(parsed.threads)).toEqual(["a"]);
    expect(parsed.threads["a"]?.groups[0]?.splitDirection).toBe("vertical");
    expect(parseTerminalLayout("{")).toEqual({ placement: "bottom", threads: {} });
    expect(parseTerminalLayout(null).placement).toBe("bottom");
  });
});
