import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useT } from "../../i18n";
import { DRAWER_MAX_RATIO, DRAWER_MIN_HEIGHT, terminalLayout, terminalsOf, useTerminalLayout } from "./terminal-layout";
import { TerminalPanel } from "./TerminalPanel";
import { useDrag } from "./use-drag";

/** Keyboard resize step of the drawer edge, in px. */
const KEY_STEP = 24;

/**
 * The bottom placement: a drawer under the conversation across the main column. Its top edge drags (or, focused, takes
 * arrow keys) between DRAWER_MIN_HEIGHT and DRAWER_MAX_RATIO of the window.
 */
export function TerminalDrawer({ threadId }: { threadId: string }) {
  const t = useT();
  useTerminalLayout();
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);
  useEffect(() => {
    const onResize = (): void => setWindowHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const max = Math.max(DRAWER_MIN_HEIGHT, Math.floor(windowHeight * DRAWER_MAX_RATIO));
  const clamp = (value: number): number => Math.min(max, Math.max(DRAWER_MIN_HEIGHT, Math.round(value)));
  const height = clamp(terminalsOf(threadId).height);
  const base = useRef(height);
  const { dragging, handlers } = useDrag("y", {
    onStart: () => { base.current = height; },
    onDrag: delta => terminalLayout.setHeight(threadId, clamp(base.current - delta)),
  });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = event.key === "ArrowUp" ? height + KEY_STEP : event.key === "ArrowDown" ? height - KEY_STEP
      : event.key === "Home" ? max : event.key === "End" ? DRAWER_MIN_HEIGHT : null;
    if (next === null) return;
    event.preventDefault();
    terminalLayout.setHeight(threadId, clamp(next));
  };
  return (
    <section className="relative box-border flex shrink-0 flex-col px-2 pb-2 pt-1" style={{ height }} data-testid="terminal-drawer" data-dragging={dragging || undefined} aria-label={t("terminal.title")}>
      <div role="separator" aria-orientation="horizontal" aria-label={t("terminal.resize")} aria-valuemin={DRAWER_MIN_HEIGHT} aria-valuemax={max} aria-valuenow={height} tabIndex={0}
        data-testid="terminal-drawer-resize" data-dragging={dragging || undefined} onKeyDown={onKeyDown} {...handlers}
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize touch-none outline-none after:absolute after:inset-x-0 after:top-[3px] after:h-0.5 after:bg-transparent after:content-[''] hover:after:bg-border focus-visible:after:bg-ring data-dragging:after:bg-ring" />
      <TerminalPanel placement="bottom" />
    </section>
  );
}
