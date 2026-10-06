import { describe, expect, it } from "vitest";
import type { SkillMetadata } from "../../shared/protocol";
import { acceptCommand, matchCommands, menuOptions } from "../../src/ui/composer/commands";
import { detectSkillTrigger } from "../../src/ui/composer/skill-draft";

const skill: SkillMetadata = { name: "ulw-loop", description: "Loop", path: "/skills/ulw-loop/SKILL.md", scope: "system", enabled: true };

describe("composer commands", () => {
  it("matches /btw by name or alias prefix in any letter case", () => {
    expect(matchCommands("").map((command) => command.name)).toEqual(["btw"]);
    expect(matchCommands("BT").map((command) => command.name)).toEqual(["btw"]);
    expect(matchCommands("si").map((command) => command.name)).toEqual(["btw"]);
    expect(matchCommands("x")).toEqual([]);
  });

  it("lists skills first for a bare slash and commands first once a query matches", () => {
    const commands = matchCommands("");
    expect(menuOptions(commands, [skill], "").map((option) => option.kind)).toEqual(["skill", "command"]);
    expect(menuOptions(matchCommands("b"), [skill], "b").map((option) => option.kind)).toEqual(["command", "skill"]);
  });

  it("replaces the typed token with the command and a space", () => {
    const start = detectSkillTrigger("/bt", 3);
    if (start === null) throw new Error("expected a trigger");
    expect(acceptCommand("/bt", start, "btw")).toEqual({ text: "/btw ", caret: 5 });
    const middle = detectSkillTrigger("ask /si now", 7);
    if (middle === null) throw new Error("expected a trigger");
    expect(acceptCommand("ask /si now", middle, "btw")).toEqual({ text: "ask /btw now", caret: 9 });
  });
});
