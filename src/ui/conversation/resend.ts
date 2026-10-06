import type { UserInput } from "../../../shared/protocol";
import { splitAttachments, type ImageInput } from "../composer/attachments";
import { projectSkillUserText } from "./skill-text";

/** A user message as the composer would send it again: skill tokens and typed text, plus its images. */
export interface Resend {
  text: string;
  images: ImageInput[];
}

/**
 * Rebuilds what the user typed from a stored user message: `/skill:<name>` tokens for expanded skills, the remaining
 * text, and the attached images; omo-injected context blocks are dropped because omo adds them again on send.
 */
export function resendOf(content: readonly UserInput[]): Resend {
  const texts: string[] = [];
  const images: ImageInput[] = [];
  for (const input of content) {
    if (input.type === "text") {
      const { text, paths } = splitAttachments(input.text);
      texts.push(text);
      for (const path of paths) images.push({ type: "localImage", path });
    } else if (input.type === "image" || input.type === "localImage") images.push(input);
  }
  const { skills, rest } = projectSkillUserText(texts.filter((text) => text !== "").join("\n"));
  const text = [...skills.map((skill) => `/skill:${skill.name}`), rest.trim()].filter((part) => part !== "").join(" ");
  return { text, images };
}

/** The text inputs of a user message joined with "\n": the form the session file is matched on when branching. */
export function storedText(content: readonly UserInput[]): string {
  return content.flatMap((input) => (input.type === "text" ? [input.text] : [])).join("\n");
}
