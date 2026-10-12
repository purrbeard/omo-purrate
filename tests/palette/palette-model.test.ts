import { describe, expect, it, vi } from "vitest";
import { buildPaletteEntries, filterPaletteEntries, type PaletteEntry } from "../../src/ui/palette/palette-model";

const entry = (id: string, title: string, kind: PaletteEntry["kind"] = "command", subtitle?: string): PaletteEntry =>
  ({ id, title, kind, subtitle, run: vi.fn() });

describe("palette entries", () => {
  it("builds commands and sessions in supplied order and defers their actions", () => {
    const command = vi.fn();
    const open = vi.fn();
    const entries = buildPaletteEntries([{ id: "settings", title: "Settings", shortcut: ["Ctrl", ","], run: command }],
      [{ id: "second", title: "Second", workspace: "/work/two" }, { id: "first", title: "First", workspace: "/work/one" }], open);
    expect(entries.map(({ id, kind, subtitle }) => ({ id, kind, subtitle }))).toEqual([
      { id: "settings", kind: "command", subtitle: undefined },
      { id: "session:second", kind: "session", subtitle: "/work/two" },
      { id: "session:first", kind: "session", subtitle: "/work/one" },
    ]);
    expect(command).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    entries[0]!.run();
    entries[1]!.run();
    expect(command).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("second");
    expect(entries[0]!.shortcut).toEqual(["Ctrl", ","]);
  });
});

describe("palette filtering", () => {
  it("returns an independent array in original order for empty queries", () => {
    const entries = [entry("one", "One"), entry("two", "Two", "session")];
    const result = filterPaletteEntries(entries, "  ");
    expect(result).toEqual(entries);
    expect(result).not.toBe(entries);
  });

  it("ranks case-insensitive exact and prefix titles ahead of word and subsequence matches", () => {
    const entries = [entry("fuzzy", "Start existing task"), entry("word", "Open settings"),
      entry("prefix", "Settings project", "session"), entry("exact", "Settings", "session"), entry("none", "Terminal")];
    expect(filterPaletteEntries(entries, " SET ").map(e => e.id)).toEqual(["prefix", "exact", "word", "fuzzy"]);
    expect(filterPaletteEntries(entries, "settings").map(e => e.id)).toEqual(["exact", "prefix", "word"]);
  });

  it("prefers commands on equal matches but not over better session titles", () => {
    const entries = [entry("session", "Settings", "session"), entry("command", "Settings"), entry("prefix", "Settings project")];
    expect(filterPaletteEntries(entries, "settings").map(e => e.id)).toEqual(["command", "session", "prefix"]);
  });

  it("matches separate words and workspace subtitles without changing entries", () => {
    const entries = [entry("title", "Open project"), entry("workspace", "Fix renderer", "session", "P:/work/project")];
    expect(filterPaletteEntries(entries, "proj op").map(e => e.id)).toEqual(["title"]);
    expect(filterPaletteEntries(entries, "PROJECT").map(e => e.id)).toEqual(["title", "workspace"]);
    expect(filterPaletteEntries(entries, "renderer project").map(e => e.id)).toEqual(["workspace"]);
    expect(filterPaletteEntries(entries, "zzzz")).toEqual([]);
    expect(entries[1]!.title).toBe("Fix renderer");
  });
});
