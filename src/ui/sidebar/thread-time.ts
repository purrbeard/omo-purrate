import { relativeTime } from "../../dsh/primitives/relative-time";
import type { Translate } from "../../i18n";

/** Compact relative time for a sidebar row: "now", "5m", "2h", "3d", "4mo", "1y" in English. */
export function formatThreadTime(at: number, now: number, t: Translate): string {
  const { unit, n } = relativeTime(at, now);
  return t(`shell.time.${unit}`, { n });
}
