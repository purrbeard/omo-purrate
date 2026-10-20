import { describe, expect, it } from "vitest";
import { nextWake, pruneExpired, sanitizeSnoozed, snoozeWakeTime } from "../../shared/snooze";

const local = (y: number, m: number, d: number, h = 0, min = 0): number => new Date(y, m - 1, d, h, min).getTime();
const HOUR = 3_600_000;

describe("snoozeWakeTime", () => {
  it("adds an hour", () => {
    const now = local(2026, 10, 20, 10, 30);
    expect(snoozeWakeTime("hour", now)).toBe(now + HOUR);
  });

  it("wakes at 18:00 today, or three hours later once 18:00 has passed", () => {
    expect(snoozeWakeTime("evening", local(2026, 10, 20, 10))).toBe(local(2026, 10, 20, 18));
    expect(snoozeWakeTime("evening", local(2026, 10, 20, 18))).toBe(local(2026, 10, 20, 18) + 3 * HOUR);
    expect(snoozeWakeTime("evening", local(2026, 10, 20, 21))).toBe(local(2026, 10, 20, 21) + 3 * HOUR);
  });

  it("wakes at 09:00 tomorrow, across a month end", () => {
    expect(snoozeWakeTime("morning", local(2026, 10, 20, 23, 59))).toBe(local(2026, 10, 21, 9));
    expect(snoozeWakeTime("morning", local(2026, 10, 31, 8))).toBe(local(2026, 11, 1, 9));
  });

  it("wakes next Monday 09:00; a Monday means the one a week away", () => {
    // 2026-10-20 is a Tuesday, 2026-10-19 a Monday, 2026-10-25 a Sunday.
    expect(snoozeWakeTime("nextWeek", local(2026, 10, 20, 12))).toBe(local(2026, 10, 26, 9));
    expect(snoozeWakeTime("nextWeek", local(2026, 10, 19, 8))).toBe(local(2026, 10, 26, 9));
    expect(snoozeWakeTime("nextWeek", local(2026, 10, 25, 23))).toBe(local(2026, 10, 26, 9));
  });
});

describe("snooze map", () => {
  it("keeps only string keys with finite positive numbers and falls back for non-objects", () => {
    const current = { keep: 5 };
    expect(sanitizeSnoozed({ a: 10, b: "x", c: Number.NaN, d: Infinity, e: -1, "": 4, f: null }, current)).toEqual({ a: 10 });
    expect(sanitizeSnoozed([1, 2], current)).toBe(current);
    expect(sanitizeSnoozed("nope", current)).toBe(current);
  });

  it("prunes expired entries (a wake time equal to now is expired) and finds the nearest wake", () => {
    expect(pruneExpired({ a: 100, b: 200, c: 300 }, 200)).toEqual({ c: 300 });
    expect(nextWake({ a: 300, b: 100 })).toBe(100);
    expect(nextWake({})).toBeNull();
  });
});
