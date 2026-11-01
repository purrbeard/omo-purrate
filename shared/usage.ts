import type { TurnUsage } from "./protocol";

/** Native counters are never inferred: zero is known, missing or invalid values are unknown. */
export function usageCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Every assistant message participates, including those with missing usage; tool results do not call this. */
export function addUsage(total: TurnUsage | null, value: unknown): TurnUsage {
  const usage = typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const sum = (key: keyof TurnUsage): number | null => {
    const next = usageCount(usage[key]);
    if (total === null) return next;
    const previous = total[key];
    return previous === null || next === null ? null : usageCount(previous + next);
  };
  return { input: sum("input"), output: sum("output"), cacheRead: sum("cacheRead"), cacheWrite: sum("cacheWrite"), totalTokens: sum("totalTokens") };
}
