import type { ConversationItem } from "../../state";

/** Only native work recorded in this turn belongs in its log. */
export function workLogEntries(items: readonly ConversationItem[]): ConversationItem[] {
  return items.filter(({ item }) => {
    switch (item.type) {
      case "reasoning":
      case "commandExecution":
      case "fileChange":
      case "mcpToolCall":
      case "dynamicToolCall":
      case "webSearch":
        return true;
      default:
        return false;
    }
  });
}
