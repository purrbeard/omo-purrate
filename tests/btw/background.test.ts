import { describe, expect, it } from "vitest";
import type { ThreadItem } from "../../shared/protocol";
import { SIDE_BACKGROUND_MARKER } from "../../src/state";
import type { Conversation, ConversationTurn, SideChat } from "../../src/state";
import { emptyConversation } from "../../src/state/conversation";
import {
  SIDE_BACKGROUND_MAX_BYTES,
  SIDE_BACKGROUND_MAX_MESSAGES,
  backgroundMessages,
  capBackground,
  sideDisplayText,
  sidePrompt,
} from "../../src/ui/btw/background";
import type { BackgroundMessage } from "../../src/ui/btw/background";

const encoder = new TextEncoder();

function user(id: string, text: string): ThreadItem {
  return { type: "userMessage", id, clientId: null, content: [{ type: "text", text, text_elements: [] }] };
}

function agent(id: string, text: string): ThreadItem {
  return { type: "agentMessage", id, text, phase: null };
}

function conversationOf(...turns: ThreadItem[][]): Conversation {
  const conversation = emptyConversation("main-1");
  const wireTurns: ConversationTurn[] = turns.map((items, index) => ({
    id: `turn-${index}`,
    status: "completed",
    error: null,
    items: items.map((item) => ({ item, streaming: false, startedAtMs: null, completedAtMs: null })),
    startedAtMs: null,
    completedAtMs: null,
    origin: "history",
  }));
  return { ...conversation, turns: wireTurns };
}

function messages(count: number, bytes: number): BackgroundMessage[] {
  return Array.from({ length: count }, (_, index) => ({ role: index % 2 === 0 ? "user" : "assistant", text: `${index}:`.padEnd(bytes, "x") }));
}

describe("backgroundMessages", () => {
  it("collects user and assistant text in turn order and skips empty messages and other items", () => {
    const reasoning: ThreadItem = { type: "reasoning", id: "r", summary: ["thinking"], content: [] };
    const conversation = conversationOf([user("u1", "fix the login bug"), reasoning, agent("a1", "  Fixed it.  ")], [user("u2", "   "), agent("a2", "")]);
    expect(backgroundMessages(conversation)).toEqual([
      { role: "user", text: "fix the login bug" },
      { role: "assistant", text: "Fixed it." },
    ]);
    expect(backgroundMessages(undefined)).toEqual([]);
  });

  it("reduces an expanded skill invocation to the skill name and the user's request", () => {
    const expanded =
      'The user explicitly invoked the "ulw-loop" skill. Follow the instructions in <skill-instruction> as binding for this request.\n\n' +
      '<skill-instruction name="ulw-loop" location="/skills/ulw-loop/SKILL.md">Run the loop with a long body.</skill-instruction>\n\n' +
      "<user-request>build the thing</user-request>";
    expect(backgroundMessages(conversationOf([user("u1", expanded)]))).toEqual([{ role: "user", text: "/ulw-loop build the thing" }]);
  });
});

describe("capBackground", () => {
  it("keeps the 64 newest messages", () => {
    const kept = capBackground(messages(SIDE_BACKGROUND_MAX_MESSAGES + 6, 10));
    expect(kept).toHaveLength(SIDE_BACKGROUND_MAX_MESSAGES);
    expect(kept[0]?.text.startsWith("6:")).toBe(true);
  });

  it("drops the oldest whole messages beyond 64 KiB", () => {
    const kept = capBackground(messages(3, 30 * 1024));
    expect(kept.map((message) => message.text.split(":")[0])).toEqual(["1", "2"]);
  });

  it("keeps the end of a single newest message over 64 KiB behind an ellipsis", () => {
    const text = `${"head".repeat(5000)}${"é".repeat(30 * 1024)}THE END`;
    const [kept] = capBackground([{ role: "assistant", text }]);
    expect(kept?.text.startsWith("…")).toBe(true);
    expect(kept?.text.endsWith("THE END")).toBe(true);
    expect(encoder.encode(kept?.text ?? "").length).toBeLessThanOrEqual(SIDE_BACKGROUND_MAX_BYTES);
    expect(kept?.text).not.toContain("\uFFFD");
  });
});

describe("sidePrompt", () => {
  it("opens with the marker and carries the title, workspace, messages and the question", () => {
    const prompt = sidePrompt({
      title: "Fix login",
      cwd: "/work/app",
      messages: [{ role: "user", text: "fix the login bug" }, { role: "assistant", text: "Done." }],
      question: "what changed?",
    });
    const lines = prompt.split("\n");
    expect(lines[0]).toBe(SIDE_BACKGROUND_MARKER);
    expect(prompt).toContain("Do not edit files, run commands that change state, or start subagents unless the user explicitly asks");
    expect(prompt).toContain("Main thread: Fix login\nWorkspace: /work/app\n\n<user>\nfix the login bug\n</user>\n<assistant>\nDone.\n</assistant>\n[end of background]");
    expect(lines.at(-1)).toBe("Side question: what changed?");
  });

  it("states that no background is attached when the context chip was removed", () => {
    const prompt = sidePrompt({ title: "Fix login", cwd: "/work/app", messages: null, question: "q" });
    expect(prompt.startsWith(SIDE_BACKGROUND_MARKER)).toBe(true);
    expect(prompt).toContain("No main conversation background is attached");
    expect(prompt).not.toContain("<user>");
    expect(prompt).not.toContain("Main thread:");
  });
});

describe("sideDisplayText", () => {
  const chat: SideChat = { id: "side-1", parentId: "main-1", question: "what changed?", createdAtMs: 1, context: true };

  it("shows the recorded question for the background-carrying first message and other text as-is", () => {
    expect(sideDisplayText(chat, `${SIDE_BACKGROUND_MARKER}\nlong background`)).toBe("what changed?");
    expect(sideDisplayText(chat, "and then?")).toBe("and then?");
  });
});
