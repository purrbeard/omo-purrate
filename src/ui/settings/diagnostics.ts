import { useEffect, useState } from "react";
import type { Diagnostics } from "../../../shared/ipc";
import { useAppSelector } from "../app-context";

export type DiagnosticsState =
  | { kind: "loading" }
  | { kind: "ready"; value: Diagnostics }
  | { kind: "failed"; message: string };

/** The readable part of an error; a leading JSON-RPC code (`-32600: …`) is dropped so it never reaches the user. */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^-?\d{3,6}:\s*/, "");
}

/** Reads `window.omo.getDiagnostics()` on mount and again on every bridge state change, keeping the last value while a refresh runs. */
export function useDiagnostics(): DiagnosticsState {
  const bridgeState = useAppSelector((state) => state.bridge?.state ?? null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsState>({ kind: "loading" });

  useEffect(() => {
    let current = true;
    window.omo.getDiagnostics().then(
      (value) => {
        if (current) setDiagnostics({ kind: "ready", value });
      },
      (error: unknown) => {
        if (current) setDiagnostics({ kind: "failed", message: errorMessage(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [bridgeState]);

  return diagnostics;
}
