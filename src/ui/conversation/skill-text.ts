export interface UserTextSkill {
  name: string;
  location: string | null;
  body: string | null;
}

export interface UserTextContext {
  tag: string;
  body: string;
}

function projectContext(text: string): { rest: string; context: UserTextContext[] } {
  const context: UserTextContext[] = [];
  let rest = text;
  const stack: { tag: string; start: number; bodyStart: number }[] = [];
  const blocks: { tag: string; body: string; start: number; end: number }[] = [];
  for (const token of text.matchAll(/<(\/?)(omo-[a-z0-9-]+|system-reminder)>/g)) {
    const tag = token[2];
    if (tag === undefined) continue;
    if (token[1] === "") {
      stack.push({ tag, start: token.index, bodyStart: token.index + token[0].length });
    } else {
      const opening = stack.pop();
      if (opening?.tag !== tag) {
        stack.length = 0;
        continue;
      }
      if (stack.length === 0 && (opening.start === 0 || text[opening.start - 1] === "\n")) {
        blocks.push({ tag, body: text.slice(opening.bodyStart, token.index), start: opening.start, end: token.index + token[0].length });
      }
    }
  }
  for (const block of blocks.reverse()) {
    if (block.end !== rest.replace(/\n+$/, "").length) break;
    context.unshift({ tag: block.tag, body: block.body });
    rest = rest.slice(0, block.start).replace(/\n+$/, "");
  }
  return { rest, context };
}

/** Projects recorded injections for display; callers retain the raw text for copy/export. */
export function projectSkillUserText(text: string): { skills: UserTextSkill[]; rest: string; context: UserTextContext[] } {
  const { context, rest: userText } = projectContext(text);
  let rest = userText;
  const invocation = /^The user explicitly invoked [^\r\n]+\n\n/.exec(rest);
  if (invocation !== null) {
    let remaining = rest.slice(invocation[0].length);
    const instructions: UserTextSkill[] = [];
    while (remaining.startsWith("<skill-instruction ")) {
      const match = /^<skill-instruction name="([\w-]+)" location="([^"\r\n]+)">((?:(?!<skill-instruction name=)[\s\S])*?)<\/skill-instruction>\n\n/.exec(remaining);
      if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) break;
      instructions.push({ name: match[1], location: match[2], body: match[3] });
      remaining = remaining.slice(match[0].length);
    }
    const request = /^<user-request>([\s\S]*?)<\/user-request>$/.exec(remaining);
    if (instructions.length > 0 && request?.[1] !== undefined) {
      const projected = projectContext(request[1]);
      return { skills: instructions, rest: projected.rest, context: [...projected.context, ...context] };
    }
  }

  const skills: UserTextSkill[] = [];
  const names = new Set<string>();
  const expanded = rest.startsWith("<skill ");
  while (rest !== "") {
    const match = expanded
      ? /^<skill name="([\w-]+)" location="([^"\r\n]+)">\n((?:(?!<skill name=)[\s\S])*?)\n<\/skill>(?=\n[ \t]*\n|$)/.exec(rest)
      : /^\/skill:([\w-]+)(?=\s|$)/.exec(rest);
    const name = match?.[1];
    if (match === null || name === undefined) break;
    if (!names.has(name)) {
      if (skills.length === 5) break;
      names.add(name);
      skills.push({ name, location: expanded ? match[2] ?? null : null, body: expanded ? match[3] ?? null : null });
    }
    rest = rest.slice(match[0].length);
    if (expanded) {
      rest = rest.replace(/^\n(?:[ \t]*\n)+/, "");
    } else {
      rest = rest.replace(/^\s+/, "");
    }
  }
  return { skills, rest, context };
}

const quotedNames = (text: string): string[] => [...text.matchAll(/"([\w-]+)"/g)].flatMap((match) => match[1] ?? []);
const envelopeNames = (text: string): string[] => [...text.matchAll(/<skill name="([\w-]+)"/g)].flatMap((match) => match[1] ?? []);

/**
 * One-line thread title text: invoked skills as `/name` tokens followed by the first line of the
 * user's own text, with omo's injected instructions and context dropped. Thread previews may be
 * cut short, so an unclosed invocation still yields its skill names and whatever request text follows.
 */
export function projectTitleText(text: string): string {
  const { skills, rest } = projectSkillUserText(text);
  let names = skills.map((skill) => skill.name);
  let body = rest;
  if (names.length === 0 && rest.startsWith("The user explicitly invoked ")) {
    names = quotedNames(rest.split("\n", 1)[0] ?? "");
    body = /<user-request>([\s\S]*?)(?:<\/user-request>|$)/.exec(rest)?.[1] ?? "";
  } else if (names.length === 0 && rest.startsWith('<skill name="')) {
    names = envelopeNames(rest);
    const end = rest.lastIndexOf("</skill>");
    body = end === -1 ? "" : rest.slice(end + "</skill>".length);
  }
  const lines = body.split("\n").map((line) => line.trim());
  const line = (names.length > 0 ? lines.find((candidate) => candidate !== "" && !candidate.startsWith("<")) : lines.find((candidate) => candidate !== "")) ?? "";
  return [...new Set(names)].map((name) => `/${name}`).concat(line === "" ? [] : [line]).join(" ");
}
