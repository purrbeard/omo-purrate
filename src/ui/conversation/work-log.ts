import type { HistoricalTask } from "../../../shared/ipc";
import type { LiveTask } from "../../../shared/protocol";
import type { ConversationItem, ConversationTurn } from "../../state";

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

/** The caller supplies only native tasks from this parent thread, never descendant or other-thread tasks.
 * The wire has no turn id or structured spawn receipt. Do not infer provenance from tool-result prose.
 * Timestamp ownership requires exactly one recorded turn window; shared boundaries and overlaps are ambiguous.
 */
export function turnSubagents(
  turn: ConversationTurn,
  turns: readonly ConversationTurn[],
  tasks: readonly (LiveTask | HistoricalTask)[],
): LiveTask[] {
  const seen = new Set<string>();
  return tasks.filter((task): task is LiveTask => {
    if ("source" in task || seen.has(task.task_id)) return false;
    const at = Date.parse(task.created_at);
    if (!Number.isFinite(at)) return false;
    const owners = turns.filter((candidate) => {
      const start = candidate.startedAtMs;
      const end = candidate.completedAtMs;
      if (start === null || !Number.isFinite(start)) return false;
      if (end === null) return candidate.status === "inProgress" && at >= start;
      // Native wire turn clocks have second precision while task clocks have milliseconds.
      // Compare at the coarser recorded precision; the unique-owner check still rejects collisions.
      const recordedAt = start % 1000 === 0 && end % 1000 === 0 ? Math.floor(at / 1000) * 1000 : at;
      return Number.isFinite(end) && end >= start && recordedAt >= start && recordedAt <= end;
    });
    if (owners.length !== 1 || owners[0] !== turn) return false;
    seen.add(task.task_id);
    return true;
  });
}

/** Only the last non-commentary answer of a successful, settled turn gets answer actions. */
export function completedAnswer(turn: ConversationTurn): ConversationItem | null {
  if (turn.status !== "completed" || turn.error !== null) return null;
  const answer = turn.items.findLast((entry) => entry.item.type === "agentMessage" && entry.item.phase !== "commentary");
  return answer !== undefined && !answer.streaming ? answer : null;
}

export function answerCompletedAt(turn: ConversationTurn, answer: ConversationItem): number | null {
  for (const at of [answer.completedAtMs, turn.completedAtMs]) {
    if (at !== null && Number.isFinite(at) && !Number.isNaN(new Date(at).getTime())) return at;
  }
  return null;
}
