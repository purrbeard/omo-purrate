import { relativeTime } from "../../dsh/primitives/relative-time";
import type { TimeFormatPreference } from "../../../shared/ipc";
import type { Translate } from "../../i18n";
import { formatClockTime } from "../time-format";

/**
 * Compact trailing time: "now", "5m", "2h" within a day, then the clock time (for example "Mar 3, 4:05 PM") honoring
 * the timeFormat preference.
 */
export function formatThreadTime(at: number, now: number, t: Translate, pref: TimeFormatPreference, locale: string): string {
  const { unit, n } = relativeTime(at, now);
  if (unit === "days" || unit === "months" || unit === "years") return formatClockTime(at, pref, locale);
  return t(`shell.time.${unit}`, { n });
}

/**
 * Sidebar row time: "now", "5m", "3h", "2d", "4mo", "1y". It stays a few characters wide at every age so the title
 * keeps the row's width; the full time is in the row's tooltip (formatThreadFullTime).
 */
export function formatRowTime(at: number, now: number, t: Translate): string {
  const { unit, n } = relativeTime(at, now);
  return t(`shell.time.${unit}`, { n });
}

const HOUR_CYCLES: Record<Exclude<TimeFormatPreference, "system">, "h12" | "h23"> = { "12h": "h12", "24h": "h23" };
const FULL_OPTIONS: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit" };
const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Full date and clock time for a row's tooltip, honoring the 12/24-hour preference; formatters are cached per
 * preference and locale because every row asks for one.
 */
export function formatThreadFullTime(at: number, pref: TimeFormatPreference, locale: string): string {
  const key = `${pref}:${locale}`;
  let format = formatters.get(key);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, pref === "system" ? FULL_OPTIONS : { ...FULL_OPTIONS, hourCycle: HOUR_CYCLES[pref] });
    formatters.set(key, format);
  }
  return format.format(at);
}
