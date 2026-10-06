import { describe, expect, it } from "vitest";
import type { SkillMetadata } from "../../shared/protocol";
import {
  acceptSkill,
  detectSkillTrigger,
  MAX_SKILLS_PER_MESSAGE,
  pruneSelected,
  rankSkills,
  serializeSkillDraft,
  skillSummary,
} from "../../src/ui/composer/skill-draft";
import type { SkillDraft, SkillTrigger } from "../../src/ui/composer/skill-draft";

function skill(name: string, extra: Partial<SkillMetadata> = {}): SkillMetadata {
  return { name, description: `${name} description`, path: `/skills/${name}/SKILL.md`, scope: "user", enabled: true, ...extra };
}

function triggerAtEnd(text: string): SkillTrigger {
  const trigger = detectSkillTrigger(text, text.length);
  if (trigger === null) throw new Error(`no trigger in ${JSON.stringify(text)}`);
  return trigger;
}

function accept(draft: SkillDraft, name: string): SkillDraft {
  const result = acceptSkill(draft, triggerAtEnd(draft.text), name);
  if (!result.ok) throw new Error(`refused ${name}`);
  return result.draft;
}

describe("detectSkillTrigger", () => {
  it("opens at the start of the text and after whitespace", () => {
    expect(detectSkillTrigger("/", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(detectSkillTrigger("/ulw", 4)).toEqual({ start: 0, end: 4, query: "ulw" });
    expect(detectSkillTrigger("do X /mass", 10)).toEqual({ start: 5, end: 10, query: "mass" });
    expect(detectSkillTrigger("line\n/a", 7)).toEqual({ start: 5, end: 7, query: "a" });
    expect(detectSkillTrigger("/skill:ulw_loop-2", 17)?.query).toBe("skill:ulw_loop-2");
  });

  it("takes the query up to the caret and the span through the rest of the token", () => {
    expect(detectSkillTrigger("/ulw-loop rest", 4)).toEqual({ start: 0, end: 9, query: "ulw" });
  });

  it("never opens inside a word, a path, a URL or a double slash", () => {
    expect(detectSkillTrigger("and/or", 6)).toBeNull();
    expect(detectSkillTrigger("src/a", 5)).toBeNull();
    expect(detectSkillTrigger("/src/a", 6)).toBeNull();
    expect(detectSkillTrigger("https://example.com/a", 21)).toBeNull();
    expect(detectSkillTrigger("see //", 6)).toBeNull();
    expect(detectSkillTrigger("//", 2)).toBeNull();
  });

  it("closes once the caret leaves the token", () => {
    expect(detectSkillTrigger("/ulw ", 5)).toBeNull();
    expect(detectSkillTrigger("/ulw.", 5)).toBeNull();
    expect(detectSkillTrigger("text", 4)).toBeNull();
    expect(detectSkillTrigger("/ulw", 0)).toBeNull();
  });
});

describe("rankSkills", () => {
  const catalog = [skill("mass-ulw"), skill("browser"), skill("ulw-loop"), skill("review", { interface: { displayName: "Code review" } })];

  it("keeps the catalog order for an empty query", () => {
    expect(rankSkills(catalog, "").map((entry) => entry.name)).toEqual(["mass-ulw", "browser", "ulw-loop", "review"]);
  });

  it("ranks prefix hits first and drops non-matches", () => {
    expect(rankSkills(catalog, "ulw").map((entry) => entry.name)).toEqual(["ulw-loop", "mass-ulw"]);
  });

  it("ignores a typed skill: prefix and matches display names", () => {
    expect(rankSkills(catalog, "skill:ulw-l").map((entry) => entry.name)).toEqual(["ulw-loop"]);
    expect(rankSkills(catalog, "code").map((entry) => entry.name)).toEqual(["review"]);
  });
});

describe("skillSummary", () => {
  it("prefers interface.shortDescription, then shortDescription, then description", () => {
    expect(skillSummary(skill("a", { shortDescription: "short", interface: { shortDescription: "ui" } }))).toBe("ui");
    expect(skillSummary(skill("a", { shortDescription: "short", interface: { shortDescription: " " } }))).toBe("short");
    expect(skillSummary(skill("a"))).toBe("a description");
  });
});

describe("acceptSkill", () => {
  it("replaces only the token span and keeps text before and after", () => {
    const draft = { text: "please /ul then stop", selected: [] };
    const trigger = detectSkillTrigger(draft.text, 10);
    if (trigger === null) throw new Error("no trigger");
    const result = acceptSkill(draft, trigger, "ulw-loop");
    expect(result).toEqual({ ok: true, draft: { text: "please /ulw-loop then stop", selected: ["ulw-loop"] }, caret: 17 });
  });

  it("appends a trailing space and places the caret after it", () => {
    const result = acceptSkill({ text: "/ul", selected: [] }, triggerAtEnd("/ul"), "ulw-loop");
    expect(result).toEqual({ ok: true, draft: { text: "/ulw-loop ", selected: ["ulw-loop"] }, caret: 10 });
  });

  it("accepts a second selection after a space", () => {
    const first = accept({ text: "/ul", selected: [] }, "ulw-loop");
    const second = accept({ ...first, text: `${first.text}/mass` }, "mass-ulw");
    expect(second).toEqual({ text: "/ulw-loop /mass-ulw ", selected: ["ulw-loop", "mass-ulw"] });
  });

  it("collapses a repeated selection", () => {
    const first = accept({ text: "/a", selected: [] }, "a");
    expect(accept({ ...first, text: `${first.text}/a` }, "a")).toEqual({ text: "/a /a ", selected: ["a"] });
  });

  it("refuses a sixth distinct skill but allows repeating a selected one", () => {
    let draft: SkillDraft = { text: "", selected: [] };
    for (const name of ["a", "b", "c", "d", "e"]) draft = accept({ ...draft, text: `${draft.text}/${name}` }, name);
    expect(draft.selected).toHaveLength(MAX_SKILLS_PER_MESSAGE);
    const sixth = `${draft.text}/f`;
    expect(acceptSkill({ ...draft, text: sixth }, triggerAtEnd(sixth), "f")).toEqual({ ok: false, reason: "limit" });
    const repeat = `${draft.text}/a`;
    expect(acceptSkill({ ...draft, text: repeat }, triggerAtEnd(repeat), "a").ok).toBe(true);
  });
});

describe("pruneSelected", () => {
  it("deselects a skill whose token was deleted or edited", () => {
    expect(pruneSelected("/a do X", ["a", "b"])).toEqual(["a"]);
    expect(pruneSelected("/ab do X", ["a"])).toEqual([]);
    expect(pruneSelected("x/a", ["a"])).toEqual([]);
  });

  it("keeps selection order and drops duplicates", () => {
    expect(pruneSelected("/b /a", ["b", "a", "b"])).toEqual(["b", "a"]);
  });
});

describe("serializeSkillDraft", () => {
  it("sends plain text without selections unchanged", () => {
    expect(serializeSkillDraft({ text: "/tmp/file is  odd", selected: [] })).toBe("/tmp/file is  odd");
  });

  it("moves selected tokens into a leading canonical run in selection order", () => {
    expect(serializeSkillDraft({ text: "/ulw-loop /mass-ulw do X", selected: ["ulw-loop", "mass-ulw"] })).toBe(
      "/skill:ulw-loop /skill:mass-ulw do X",
    );
    expect(serializeSkillDraft({ text: "/mass-ulw do X /ulw-loop", selected: ["ulw-loop", "mass-ulw"] })).toBe(
      "/skill:ulw-loop /skill:mass-ulw do X",
    );
  });

  it("keeps text before and after a token selected after prose", () => {
    expect(serializeSkillDraft({ text: "do X /mass-ulw then  Y", selected: ["mass-ulw"] })).toBe("/skill:mass-ulw do X then  Y");
  });

  it("keeps line breaks around a removed token", () => {
    expect(serializeSkillDraft({ text: "first /a\nsecond", selected: ["a"] })).toBe("/skill:a first\nsecond");
  });

  it("deduplicates repeated tokens and sends only the run for a skills-only draft", () => {
    expect(serializeSkillDraft({ text: "/a /a", selected: ["a", "a"] })).toBe("/skill:a");
  });

  it("drops selections whose token is gone and leaves unselected slash words", () => {
    expect(serializeSkillDraft({ text: "/b /other", selected: ["a", "b"] })).toBe("/skill:b /other");
  });

  it("serializes at most five distinct skills and leaves the rest as text", () => {
    const text = "/a /b /c /d /e /f go";
    expect(serializeSkillDraft({ text, selected: ["a", "b", "c", "d", "e", "f"] })).toBe(
      "/skill:a /skill:b /skill:c /skill:d /skill:e /f go",
    );
  });
});
