import type { ContextUsage } from "../../shared/workbench";
import { readSessionLines } from "../history/session-lines";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function token(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function readContextUsage(text: string): ContextUsage {
  const parser = new ContextUsageParser();
  for (const line of text.split("\n")) parser.add(line);
  return parser.result();
}

export async function readContextUsageFile(file: string): Promise<ContextUsage> {
  const parser = new ContextUsageParser();
  for await (const line of readSessionLines(file)) parser.add(line);
  return parser.result();
}

interface UsageEntry { parentId: string | null; compacted: boolean; usage: ContextUsage | null }

/** Only branch links and usage survive each record; large messages and tool results are released immediately. */
export class ContextUsageParser {
  private readonly entries = new Map<string, UsageEntry>();
  private leaf: string | null = null;

  add(line: string): void {
    let entry: unknown;
    try { entry = JSON.parse(line); }
    catch { return; }
    if (!object(entry) || entry["type"] === "session" || typeof entry["type"] !== "string" || typeof entry["id"] !== "string") return;
    let context: ContextUsage | null = null;
    const message = entry["message"];
    if (entry["type"] === "message" && object(message) && message["role"] === "assistant" && object(message["usage"])) {
      const usage = message["usage"];
      const parts = [usage["input"], usage["output"], usage["cacheRead"], usage["cacheWrite"]];
      const tokens = parts.every(token) ? parts.reduce((sum, value) => sum + value, 0)
        : token(usage["totalTokens"]) ? usage["totalTokens"] : null;
      if (tokens !== null) context = {
        tokens,
        provider: typeof message["provider"] === "string" ? message["provider"] : null,
        model: typeof message["model"] === "string" ? message["model"] : null,
        compacted: false,
      };
    }
    this.entries.set(entry["id"], { parentId: typeof entry["parentId"] === "string" ? entry["parentId"] : null, compacted: entry["type"] === "compaction", usage: context });
    this.leaf = entry["id"];
  }

  result(): ContextUsage {
    const seen = new Set<string>();
    let compacted = false;
    let leaf = this.leaf;
    while (leaf !== null && !seen.has(leaf)) {
      seen.add(leaf);
      const entry = this.entries.get(leaf);
      if (!entry) break;
      if (entry.compacted) compacted = true;
      if (entry.usage !== null) return { ...entry.usage, tokens: compacted ? null : entry.usage.tokens, compacted };
      leaf = entry.parentId;
    }
    return { tokens: null, provider: null, model: null, compacted: false };
  }
}
