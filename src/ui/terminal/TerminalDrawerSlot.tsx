import { lazy, Suspense } from "react";
import { selectMainThreadId } from "../../state";
import { useAppSelector } from "../app-context";
import { shownTab, useUiState } from "../ui-state";
import { terminalsOf, useTerminalLayout } from "./terminal-layout";

// xterm loads with the drawer on first use, keeping it out of the entry chunk.
const TerminalDrawer = lazy(() => import("./TerminalDrawer").then(module => ({ default: module.TerminalDrawer })));

/**
 * Where the bottom drawer mounts under the conversation. It shows for the main thread when the placement is bottom and
 * the drawer is open, unless the side panel already shows the terminal (one panel per thread at a time).
 */
export function TerminalDrawerSlot() {
  const threadId = useAppSelector(selectMainThreadId);
  const { placement } = useTerminalLayout();
  const dockShowsTerminal = shownTab(useUiState()) === "terminal";
  if (threadId === null || placement !== "bottom" || dockShowsTerminal || !terminalsOf(threadId).open) return null;
  return <Suspense fallback={null}><TerminalDrawer threadId={threadId} /></Suspense>;
}
