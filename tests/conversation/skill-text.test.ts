import { describe, expect, it } from "vitest";
import { projectSkillUserText, projectTitleText } from "../../src/ui/conversation/skill-text";

const envelope = (name: string, body = "instructions", location = `/skills/${name}/SKILL.md`) =>
  `<skill name="${name}" location="${location}">\n${body}\n</skill>`;

describe("projectSkillUserText", () => {
  it("projects one envelope with an empty remainder", () => {
    expect(projectSkillUserText(envelope("alpha"))).toEqual({
      skills: [{ name: "alpha", location: "/skills/alpha/SKILL.md", body: "instructions" }],
      rest: "",
      context: [],
    });
  });

  it("projects two consecutive envelopes in order", () => {
    expect(projectSkillUserText(`${envelope("alpha")}\n\n${envelope("beta", "<b>literal</b>")}`).skills).toEqual([
      { name: "alpha", location: "/skills/alpha/SKILL.md", body: "instructions" },
      { name: "beta", location: "/skills/beta/SKILL.md", body: "<b>literal</b>" },
    ]);
  });

  it("preserves trailing user text without trimming it", () => {
    const rest = "  do X\n\nkeep spacing  ";
    expect(projectSkillUserText(`${envelope("alpha")}\n\n${rest}`).rest).toBe(rest);
  });

  it("projects envelopes separated by several whitespace-only blank lines", () => {
    expect(projectSkillUserText(`${envelope("alpha")}\n \n\n\t\n${envelope("beta")}`).skills.map((skill) => skill.name)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("projects whitespace-separated canonical tokens without instruction bodies", () => {
    expect(projectSkillUserText("/skill:ulw-loop \n/skill:mass-ulw\tDo X\n  exactly  ")).toEqual({
      skills: [
        { name: "ulw-loop", location: null, body: null },
        { name: "mass-ulw", location: null, body: null },
      ],
      rest: "Do X\n  exactly  ",
      context: [],
    });
  });

  it("consumes duplicate canonical names but keeps the first occurrence", () => {
    expect(projectSkillUserText("/skill:alpha /skill:alpha /skill:beta").skills.map((skill) => skill.name)).toEqual(["alpha", "beta"]);
  });

  it("keeps the first recorded location and body for duplicate envelopes", () => {
    expect(projectSkillUserText(`${envelope("alpha", "first")}\n\n${envelope("alpha", "second", "/other")}`)).toEqual({
      skills: [{ name: "alpha", location: "/skills/alpha/SKILL.md", body: "first" }],
      rest: "",
      context: [],
    });
  });

  it("leaves a sixth distinct token and its trailing text literal", () => {
    expect(projectSkillUserText("/skill:a /skill:b /skill:c /skill:d /skill:e /skill:e /skill:f task")).toEqual({
      skills: ["a", "b", "c", "d", "e"].map((name) => ({ name, location: null, body: null })),
      rest: "/skill:f task",
      context: [],
    });
  });

  it("leaves a sixth distinct envelope literal", () => {
    const text = ["a", "b", "c", "d", "e", "f"].map((name) => envelope(name)).join("\n\n");
    expect(projectSkillUserText(text).rest).toBe(envelope("f"));
  });

  it("stops at unknown syntax after a canonical token", () => {
    expect(projectSkillUserText("/skill:alpha /word /skill:beta").rest).toBe("/word /skill:beta");
  });

  it("stops at a malformed envelope after a valid envelope", () => {
    const malformed = '<skill name="beta">\nbody\n</skill>';
    expect(projectSkillUserText(`${envelope("alpha")}\n\n${malformed}`).rest).toBe(malformed);
  });

  it("preserves an empty recorded body", () => {
    expect(projectSkillUserText(envelope("alpha", "")).skills[0]?.body).toBe("");
  });

  it.each([
    "",
    "/word task",
    "$alpha task",
    "/skill:",
    "/skill:alpha/path",
    "/skill:alpha.",
    "https://example.com/skill:alpha",
    "/absolute/path/SKILL.md",
    "do X /skill:alpha",
    " /skill:alpha",
    '<skill name="alpha">\nbody\n</skill>',
    '<skill name="alpha" location="/skills/alpha">\nbody',
    '<skill name="alpha" location="/skills/alpha">body</skill>',
    '<skill name="alpha" location="/skills/alpha">\nbody\n</skill>trailing',
    '<skill name="alpha" location="/skills/alpha">\nunclosed\n\n' + envelope("beta"),
  ])("leaves unrecognized text unchanged: %s", (text) => {
    expect(projectSkillUserText(text)).toEqual({ skills: [], rest: text, context: [] });
  });

  const instruction = (name: string) =>
    `<skill-instruction name="${name}" location="/synthetic/${name}/SKILL.md">Use ${name}.</skill-instruction>`;
  const invocation = (names: string[], request: string) =>
    `The user explicitly invoked the "${names.join('", "')}" skill. Follow the instructions in <skill-instruction> as binding for this request, while respecting higher-priority instructions.\n\n${names.map(instruction).join("\n\n")}\n\n<user-request>${request}</user-request>`;

  it.each([["alpha"], ["alpha", "beta"]])("projects plugin instructions for %j", (...names) => {
    expect(projectSkillUserText(invocation(names, "  Do the task.\n"))).toEqual({
      skills: names.map((name) => ({ name, location: `/synthetic/${name}/SKILL.md`, body: `Use ${name}.` })),
      rest: "  Do the task.\n",
      context: [],
    });
  });

  it("preserves an empty plugin user request", () => {
    expect(projectSkillUserText(invocation(["alpha"], "")).rest).toBe("");
  });

  it("projects trailing contexts in order and removes only separating newlines", () => {
    expect(projectSkillUserText("  Task  \n\n<omo-ulw-loop-pointer>Loop.</omo-ulw-loop-pointer>\n<system-reminder>\nReminder.\n</system-reminder>\n<omo-future-tag>Future.</omo-future-tag>")).toEqual({
      skills: [],
      rest: "  Task  ",
      context: [
        { tag: "omo-ulw-loop-pointer", body: "Loop." },
        { tag: "system-reminder", body: "\nReminder.\n" },
        { tag: "omo-future-tag", body: "Future." },
      ],
    });
  });

  it("projects context without user text", () => {
    expect(projectSkillUserText("<omo-ultrawork-reminder></omo-ultrawork-reminder>")).toEqual({
      skills: [], rest: "", context: [{ tag: "omo-ultrawork-reminder", body: "" }],
    });
  });

  it.each(["outside", "inside"])("combines plugin skills with context %s the request", (where) => {
    const block = "<omo-senpi-ulw-loop>Run.</omo-senpi-ulw-loop>";
    const text = where === "outside" ? `${invocation(["alpha"], "Task")}\n${block}` : invocation(["alpha"], `Task\n${block}`);
    expect(projectSkillUserText(text)).toEqual({
      skills: [{ name: "alpha", location: "/synthetic/alpha/SKILL.md", body: "Use alpha." }],
      rest: "Task",
      context: [{ tag: "omo-senpi-ulw-loop", body: "Run." }],
    });
  });

  it.each(["/skill:alpha Task", `${envelope("alpha")}\n\nTask`])("combines existing skills with context: %s", (text) => {
    const result = projectSkillUserText(`${text}\n<omo-mass-ulw-pointer>Dispatch.</omo-mass-ulw-pointer>`);
    expect(result.skills[0]?.name).toBe("alpha");
    expect(result.rest).toBe("Task");
    expect(result.context).toEqual([{ tag: "omo-mass-ulw-pointer", body: "Dispatch." }]);
  });

  it.each([
    "Task\n<omo-loop>Unclosed",
    "Task\n<omo-loop>Mismatch</omo-other>",
    "Task\n<omo-loop attr=\"x\">Attributes</omo-loop>",
    "Task\n<other>Not injected</other>",
    "Task <omo-loop>Inline</omo-loop>",
    "Task\n<omo-loop>Middle</omo-loop>\nMore user text",
    "Task\n<omo-loop>Unclosed\n<omo-loop>Inner</omo-loop>",
    invocation(["alpha"], "Task").replace("</skill-instruction>", ""),
    invocation(["alpha"], "Task").replace("</user-request>", ""),
    invocation(["alpha"], "Task").replace('location="/synthetic/alpha/SKILL.md"', ""),
  ])("preserves malformed or nontrailing injections: %s", (text) => {
    expect(projectSkillUserText(text)).toEqual({ skills: [], rest: text, context: [] });
  });
});

describe("projectTitleText", () => {
  it("keeps the first non-blank line of plain text", () => {
    expect(projectTitleText("\n  fix the build  \nmore")).toBe("fix the build");
  });
  it("titles a complete plugin invocation with its skills and request", () => {
    const text = 'The user explicitly invoked the "ulw-loop" skill. Follow the instructions in <skill-instruction> as binding.\n\n<skill-instruction name="ulw-loop" location="/s/ulw-loop/SKILL.md">Run.</skill-instruction>\n\n<user-request>build the thing\nmore</user-request>';
    expect(projectTitleText(text)).toBe("/ulw-loop build the thing");
  });
  it("titles a truncated plugin invocation from its preamble", () => {
    expect(projectTitleText('The user explicitly invoked the "ulw-loop" and "mass-ulw" skills. Follow the instructions in <skill-instruction> as bind')).toBe("/ulw-loop /mass-ulw");
  });
  it("titles a truncated envelope preview by its skill names", () => {
    expect(projectTitleText('<skill name="ulw-loop" location="/s/ulw-loop/SKILL.md">\nReferences are rela')).toBe("/ulw-loop");
  });
  it("drops trailing omo context from the title", () => {
    expect(projectTitleText("deploy now\n<omo-ultrawork-reminder>armed</omo-ultrawork-reminder>")).toBe("deploy now");
  });
  it("titles canonical tokens with their text", () => {
    expect(projectTitleText("/skill:ulw-loop /skill:mass-ulw do X")).toBe("/ulw-loop /mass-ulw do X");
  });
  it("returns an empty string for empty text", () => {
    expect(projectTitleText("")).toBe("");
  });
});
