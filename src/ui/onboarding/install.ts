import { useCallback, useEffect, useRef, useState } from "react";
import type { InstallLogLine } from "../../../shared/ipc";

const MAX_LOG_LINES = 400;

export type InstallPhase =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "succeeded" }
  | { kind: "failed"; exitCode: number | null; message: string | null };

export interface Installer {
  phase: InstallPhase;
  lines: readonly InstallLogLine[];
  start(): void;
}

/**
 * Runs `window.omo.install()` and collects the lines streamed through `onInstallLog` while it runs
 * (the newest {@link MAX_LOG_LINES}). A rejected bridge call becomes a failed phase with its message.
 */
export function useInstaller(): Installer {
  const [phase, setPhase] = useState<InstallPhase>({ kind: "idle" });
  const [lines, setLines] = useState<readonly InstallLogLine[]>([]);
  const running = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(
    () =>
      window.omo.onInstallLog((line) => {
        if (!running.current) return;
        setLines((current) => [...current.slice(-(MAX_LOG_LINES - 1)), line]);
      }),
    [],
  );

  const start = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setLines([]);
    setPhase({ kind: "running" });
    window.omo.install().then(
      (result) => {
        running.current = false;
        if (!mounted.current) return;
        setPhase(result.ok ? { kind: "succeeded" } : { kind: "failed", exitCode: result.exitCode, message: null });
      },
      (error: unknown) => {
        running.current = false;
        if (!mounted.current) return;
        setPhase({ kind: "failed", exitCode: null, message: error instanceof Error ? error.message : String(error) });
      },
    );
  }, []);

  return { phase, lines, start };
}
