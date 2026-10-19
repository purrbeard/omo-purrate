import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

interface DragCallbacks {
  onStart(): void;
  /** Pointer travel since the drag started along the axis, in px; called at most once per frame. */
  onDrag(delta: number): void;
  onEnd?(): void;
}

/**
 * Pointer-capture dragging along one axis (the same pattern as the shell's column handles): the handle keeps receiving
 * moves outside itself, moves are coalesced per animation frame, and a lost capture ends the drag.
 */
export function useDrag(axis: "x" | "y", callbacks: DragCallbacks) {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(callbacks);
  latest.current = callbacks;
  const capture = useRef<{ element: HTMLElement; id: number } | null>(null);
  const origin = useRef(0);
  const position = useRef(0);
  const frame = useRef<number | null>(null);
  const coordinate = (event: ReactPointerEvent): number => axis === "x" ? event.clientX : event.clientY;

  const end = useCallback(() => {
    const active = capture.current;
    if (active === null) return;
    capture.current = null;
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    if (active.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id);
    setDragging(false);
    latest.current.onEnd?.();
  }, []);
  useEffect(() => end, [end]);

  return {
    dragging,
    handlers: {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>): void => {
        if (event.button !== 0 || capture.current !== null) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        capture.current = { element: event.currentTarget, id: event.pointerId };
        origin.current = position.current = coordinate(event);
        latest.current.onStart();
        setDragging(true);
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>): void => {
        if (capture.current?.id !== event.pointerId) return;
        position.current = coordinate(event);
        frame.current ??= requestAnimationFrame(() => {
          frame.current = null;
          latest.current.onDrag(position.current - origin.current);
        });
      },
      onPointerUp: (event: ReactPointerEvent<HTMLElement>): void => {
        if (capture.current?.id !== event.pointerId) return;
        latest.current.onDrag(coordinate(event) - origin.current);
        end();
      },
      onPointerCancel: (event: ReactPointerEvent<HTMLElement>): void => { if (capture.current?.id === event.pointerId) end(); },
      onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>): void => { if (capture.current?.id === event.pointerId) end(); },
    },
  };
}
