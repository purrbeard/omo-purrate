import { describe, expect, it } from "vitest";
import { detectMagicKeyword, findMagicKeywords, keywordHints, segmentDraft } from "../../src/ui/composer/magic-keyword";
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

  it("matches ulw plan and ulw research like omo, keeping overlapping keywords longest first", () => {
    expect(findMagicKeywords("mass ulw research")).toEqual([
      { keyword: "ulw-research", text: "mass ulw research", start: 0, end: 17 },
      { keyword: "mass-ulw", text: "mass ulw", start: 0, end: 8 },
    ]);
    expect(keywordHints(findMagicKeywords("mass ulw research"))).toEqual(["ulw-research", "mass-ulw"]);
    expect(detectMagicKeyword("ulw plan the migration")).toMatchObject({ keyword: "ulw-plan", text: "ulw plan" });
    expect(detectMagicKeyword("ulw-research caching")).toMatchObject({ keyword: "ulw-research", text: "ulw-research" });
    expect(findMagicKeywords("mulw then ulw mass").map((match) => match.keyword)).toEqual(["mass-ulw", "mass-ulw"]);
    expect(keywordHints(findMagicKeywords("ulw and ultrawork"))).toEqual(["ulw"]);
    expect(findMagicKeywords("ulw-execute it")).toEqual([{ keyword: "ulw", text: "ulw", start: 0, end: 3 }]);
  });

  it("ignores keywords in code, quotes, URLs, blockquotes, relayed lines and do-not phrases", () => {
    for (const text of ["run `ulw` here", "```\nulw-loop\n```", "say \"mass ulw\" aloud", "see https://x.dev/ulw-plan", "> ulw loop", "[REPORT] ulw done", "do not use ulw-loop here"]) {
      expect(findMagicKeywords(text), text).toEqual([]);
    }
    expect(findMagicKeywords("don't run ulw loop, but ulw plan it").map((match) => match.keyword)).toEqual(["ulw-plan"]);
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
    expect(segmentDraft("go mass ulw research!")).toEqual([{ kind: "text", text: "go " }, { kind: "keyword", text: "mass ulw research" }, { kind: "text", text: "!" }]);
  });

  it("preserves raw mass-ulw text through highlighting and transport serialization", () => {
    for (const text of ["  MASS ulw: fix it\n", "please mass-ulw then ULW", "/mass-ulw  keep this spacing"]) {
      expect(segmentDraft(text).map((segment) => segment.text).join("")).toBe(text);
      expect(serializeSkillDraft({ text, selected: [] })).toBe(text);
    }
    expect(serializeSkillDraft({ text: "/review /MASS-ULW  fix it", selected: ["review"] })).toBe("/skill:review /MASS-ULW  fix it");
  });
});
