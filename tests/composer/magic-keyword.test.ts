import { describe, expect, it } from "vitest";
import { detectMagicKeyword, findMagicKeywords, segmentDraft } from "../../src/ui/composer/magic-keyword";
import { serializeSkillDraft } from "../../src/ui/composer/skill-draft";

describe("detectMagicKeyword", () => {
  it("matches ulw and ultrawork as whole words, case-insensitively", () => {
    expect(detectMagicKeyword("ulw fix the login bug")).toEqual({ keyword: "ulw", text: "ulw", start: 0, end: 3 });
    expect(detectMagicKeyword("please ULW now")).toMatchObject({ keyword: "ulw", text: "ULW", start: 7 });
    expect(detectMagicKeyword("Ultrawork: ship it")).toMatchObject({ keyword: "ultrawork", text: "Ultrawork" });
    expect(detectMagicKeyword("(ulw)")).toMatchObject({ keyword: "ulw", start: 1, end: 4 });
    expect(detectMagicKeyword("line one\nulw")).toMatchObject({ keyword: "ulw", start: 9 });
  });

  it("matches ulw-loop and the /ulw-loop command", () => {
    expect(detectMagicKeyword("ulw-loop please")).toEqual({ keyword: "ulw-loop", text: "ulw-loop", start: 0, end: 8 });
    expect(detectMagicKeyword("please /ulw-loop then stop")).toEqual({ keyword: "ulw-loop", text: "/ulw-loop", start: 7, end: 16 });
    expect(detectMagicKeyword("/ULW-LOOP")).toMatchObject({ keyword: "ulw-loop", text: "/ULW-LOOP" });
  });

  it("matches mass ulw variants as one keyword before ulw", () => {
    for (const text of ["mass ulw", "mass-ulw", "/mass-ulw", "MASS ULW", "/MASS-ULW", "mass\tulw"]) {
      expect(detectMagicKeyword(text)).toEqual({ keyword: "mass-ulw", text, start: 0, end: text.length });
    }
    expect(findMagicKeywords("please mass ulw, then ulw")).toEqual([
      { keyword: "mass-ulw", text: "mass ulw", start: 7, end: 15 },
      { keyword: "ulw", text: "ulw", start: 22, end: 25 },
    ]);
  });

  it("ignores the keyword inside other tokens", () => {
    for (const text of ["ulw-loopx", "x/ulw-loop", "mass-ulwx", "xmass-ulw", "x/mass-ulw", "mass-ulw/", "mass-ulw_mode", "ulwx", "xulw", "ulw/", "ulw_mode", "ultraworker", "my_ulw"]) {
      expect(detectMagicKeyword(text), text).toBeNull();
    }
  });

  it("returns null for drafts without a keyword", () => {
    expect(detectMagicKeyword("")).toBeNull();
    expect(detectMagicKeyword("fix the login bug")).toBeNull();
  });

  it("lists every occurrence in order", () => {
    expect(findMagicKeywords("ulw then ultrawork then ulw").map((match) => match.text)).toEqual(["ulw", "ultrawork", "ulw"]);
  });
});

describe("segmentDraft", () => {
  it("splits text around the keywords and keeps every character", () => {
    const text = "say ulw, then ULTRAWORK.";
    const segments = segmentDraft(text);
    expect(segments).toEqual([
      { kind: "text", text: "say " },
      { kind: "keyword", text: "ulw" },
      { kind: "text", text: ", then " },
      { kind: "keyword", text: "ULTRAWORK" },
      { kind: "text", text: "." },
    ]);
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
  });

  it("returns one plain segment for text without keywords, including the empty draft", () => {
    expect(segmentDraft("")).toEqual([{ kind: "text", text: "" }]);
    expect(segmentDraft("mass-ulwx")).toEqual([{ kind: "text", text: "mass-ulwx" }]);
    expect(segmentDraft("/ulw-loop go")).toEqual([{ kind: "keyword", text: "/ulw-loop" }, { kind: "text", text: " go" }]);
  });

  it("preserves raw mass-ulw text through highlighting and transport serialization", () => {
    for (const text of ["  MASS ulw: fix it\n", "please mass-ulw then ULW", "/mass-ulw  keep this spacing"]) {
      expect(segmentDraft(text).map((segment) => segment.text).join("")).toBe(text);
      expect(serializeSkillDraft({ text, selected: [] })).toBe(text);
    }
    expect(serializeSkillDraft({ text: "/review /MASS-ULW  fix it", selected: ["review"] })).toBe("/skill:review /MASS-ULW  fix it");
  });
});
