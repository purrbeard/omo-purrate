import { SIDE_BACKGROUND_MARKER } from "../../state";
import type { Conversation, SideChat } from "../../state";
import { projectSkillUserText } from "../conversation/skill-text";

export const SIDE_BACKGROUND_END = "[end of background]";
export const SIDE_QUESTION_LABEL = "Side question:";
/** omo's TUI /btw passes at most the 64 most recent main messages and 64 KiB of their text; OmO UI uses the same caps. */
export const SIDE_BACKGROUND_MAX_MESSAGES = 64;
export const SIDE_BACKGROUND_MAX_BYTES = 64 * 1024;

export interface BackgroundMessage {
  role: "user" | "assistant";
  text: string;
}

const encoder = new TextEncoder();
const ELLIPSIS = "…";

function userText(raw: string): string {
  const { skills, rest } = projectSkillUserText(raw);
  const invocation = skills.map((skill) => `/${skill.name}`).join(" ");
  return [invocation, rest.trim()].filter((part) => part !== "").join(" ");
}

/**
 * @returns the user and assistant message text of a conversation in turn order; skill instruction bodies and
 *   trailing omo context blocks are reduced to the skill names and the user's own request
 */
export function backgroundMessages(conversation: Conversation | undefined): BackgroundMessage[] {
  if (conversation === undefined) return [];
  const messages: BackgroundMessage[] = [];
  for (const turn of conversation.turns) {
    for (const { item } of turn.items) {
      if (item.type === "userMessage") {
        const text = userText(item.content.map((part) => (part.type === "text" ? part.text : "")).join("\n"));
        if (text !== "") messages.push({ role: "user", text });
      } else if (item.type === "agentMessage") {
        const text = item.text.trim();
        if (text !== "") messages.push({ role: "assistant", text });
      }
    }
  }
  return messages;
}

function tail(text: string, maxBytes: number): string {
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return text;
  const kept = bytes.subarray(bytes.length - (maxBytes - encoder.encode(ELLIPSIS).length));
  return ELLIPSIS + new TextDecoder().decode(kept).replace(/^\uFFFD+/u, "");
}

/**
 * Keeps the newest messages within 64 messages and 64 KiB of UTF-8 text, dropping the oldest whole messages; when
 * the newest message alone exceeds 64 KiB, its end is kept behind an ellipsis.
 */
export function capBackground(messages: readonly BackgroundMessage[]): BackgroundMessage[] {
  const recent = messages.slice(-SIDE_BACKGROUND_MAX_MESSAGES);
  const kept: BackgroundMessage[] = [];
  let bytes = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    if (message === undefined) continue;
    const size = encoder.encode(message.text).length;
    if (bytes + size > SIDE_BACKGROUND_MAX_BYTES) {
      if (kept.length === 0) kept.push({ ...message, text: tail(message.text, SIDE_BACKGROUND_MAX_BYTES) });
      break;
    }
    kept.push(message);
    bytes += size;
  }
  return kept.reverse();
}

export interface SidePromptInput {
  title: string;
  cwd: string;
  /** The capped background, or null when the context chip was removed. */
  messages: readonly BackgroundMessage[] | null;
  question: string;
}

/**
 * @returns the first message of a side chat: the marker line, the read-only rule, the main thread's title, workspace
 *   and messages, the end line, then the question
 */
export function sidePrompt({ title, cwd, messages, question }: SidePromptInput): string {
  const lines = [SIDE_BACKGROUND_MARKER];
  if (messages === null) {
    lines.push("No main conversation background is attached to this side chat.");
  } else {
    lines.push(
      "Below is recent context from the user's main OmO conversation, given as read-only background for a side question. " +
        "Answer from it. Do not edit files, run commands that change state, or start subagents unless the user explicitly asks in this side chat.",
      `Main thread: ${title}`,
      `Workspace: ${cwd}`,
      "",
      ...messages.map(({ role, text }) => `<${role}>\n${text}\n</${role}>`),
    );
  }
  lines.push(SIDE_BACKGROUND_END, "", `${SIDE_QUESTION_LABEL} ${question}`);
  return lines.join("\n");
}

/** @returns the text a side transcript shows for a user message: the recorded question for the background-carrying first message */
export function sideDisplayText(side: SideChat, text: string): string {
  return text.startsWith(SIDE_BACKGROUND_MARKER) ? side.question : text;
}
