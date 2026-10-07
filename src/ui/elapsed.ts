import { useEffect, useState } from "react";

/** A live duration only when the caller has a recorded start; unknown starts never create a timer. */
export function useElapsedMs(startedAtMs: number | null): number | null {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (startedAtMs === null) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAtMs]);
  return startedAtMs === null ? null : Math.max(0, nowMs - startedAtMs);
}
