import type { ContextUsage } from "../../shared/workbench";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function token(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function readContextUsage(text: string): ContextUsage {
  const entries = new Map<string, Record<string, unknown>>();
  let leaf: string | null = null;
  for (const line of text.split("\n")) {
    let entry: unknown;
    try { entry = JSON.parse(line); }
    catch { continue; }
    if (!object(entry) || entry["type"] === "session" || typeof entry["type"] !== "string" || typeof entry["id"] !== "string") continue;
    entries.set(entry["id"], entry);
    leaf = entry["id"];
  }
  const seen = new Set<string>();
  let compacted = false;
  while (leaf !== null && !seen.has(leaf)) {
    seen.add(leaf);
    const entry = entries.get(leaf);
    if (!entry) break;
    if (entry["type"] === "compaction") compacted = true;
    const message = entry["message"];
    if (entry["type"] === "message" && object(message) && message["role"] === "assistant" && object(message["usage"])) {
      const usage = message["usage"];
      const parts = [usage["input"], usage["output"], usage["cacheRead"], usage["cacheWrite"]];
      const tokens = parts.every(token) ? parts.reduce((sum, value) => sum + value, 0)
        : token(usage["totalTokens"]) ? usage["totalTokens"] : null;
      if (tokens !== null) return {
        tokens: compacted ? null : tokens,
        provider: typeof message["provider"] === "string" ? message["provider"] : null,
        model: typeof message["model"] === "string" ? message["model"] : null,
        compacted,
      };
    }
    leaf = typeof entry["parentId"] === "string" ? entry["parentId"] : null;
  }
  return { tokens: null, provider: null, model: null, compacted: false };
}
