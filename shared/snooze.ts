/** Snooze presets offered by the thread menu and the bulk bar. */
export type SnoozePreset = "hour" | "evening" | "morning" | "nextWeek";

export const SNOOZE_PRESETS: readonly SnoozePreset[] = ["hour", "evening", "morning", "nextWeek"];

const HOUR_MS = 60 * 60 * 1000;
const MAX_SNOOZED = 500;

/** Local time at `hour:00` on the day `dayOffset` days after `nowMs`'s local day. */
function localAt(nowMs: number, dayOffset: number, hour: number): number {
  const now = new Date(nowMs);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, 0, 0, 0).getTime();
}

/**
 * The wake time (epoch ms) of a preset, in the machine's local time zone:
 * 1 hour from now; 18:00 today (or +3h once 18:00 has passed); 09:00 tomorrow; 09:00 on the next Monday (a Monday
 * today means the Monday a week away).
 */
export function snoozeWakeTime(preset: SnoozePreset, nowMs: number): number {
  switch (preset) {
    case "hour":
      return nowMs + HOUR_MS;
    case "evening": {
      const evening = localAt(nowMs, 0, 18);
      return evening > nowMs ? evening : nowMs + 3 * HOUR_MS;
    }
    case "morning":
      return localAt(nowMs, 1, 9);
    case "nextWeek": {
      const weekday = new Date(nowMs).getDay();
      return localAt(nowMs, ((8 - weekday) % 7) || 7, 9);
    }
  }
}

/** Validates a stored or incoming snooze map: string keys, finite positive numbers. Anything else keeps `current`. */
export function sanitizeSnoozed(value: unknown, current: Record<string, number>): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return current;
  const next: Record<string, number> = {};
  for (const [id, wake] of Object.entries(value)) {
    if (id !== "" && typeof wake === "number" && Number.isFinite(wake) && wake > 0) next[id] = wake;
  }
  return Object.fromEntries(Object.entries(next).sort((a, b) => a[1] - b[1]).slice(0, MAX_SNOOZED));
}

/** Drops entries whose wake time has passed. */
export function pruneExpired(snoozed: Readonly<Record<string, number>>, nowMs: number): Record<string, number> {
  return Object.fromEntries(Object.entries(snoozed).filter(([, wake]) => wake > nowMs));
}

/** The earliest wake time (possibly already overdue), or null when nothing is snoozed. */
export function nextWake(snoozed: Readonly<Record<string, number>>): number | null {
  const wakes = Object.values(snoozed);
  return wakes.length === 0 ? null : Math.min(...wakes);
}
