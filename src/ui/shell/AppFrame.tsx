import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { TESTID } from "../testids";
import { useModalLayer } from "../../dsh/primitives/useModalLayer";
import { useT } from "../../i18n";
import { CENTER_MIN, RIGHTBAR_MIN, computeColumns } from "./columns";
import clsx from "clsx";

export interface AppFrameProps {
  sidebar: ReactNode;
  main: ReactNode;
  sidebarVisible: boolean;
  sidebarWidth: number;
  onSidebarWidthChange(width: number): void;
  /** Renders the right panel; it docks as a third column when the frame has room and overlays the main column otherwise. */
  rightPanel?: ((placement: "docked" | "overlay") => ReactNode) | null;
  /** Requested docked width of the right panel in px; columns.ts clamps it. */
  rightPanelWidth?: number;
  /** Reports whether the frame currently has room for a docked right column. */
  onCanDockChange?(canDock: boolean): void;
  /** Receives the width the user drags the docked right panel to; without it the panel edge does not resize. */
  onRightPanelWidthChange?(width: number): void;
  /** Which side of the conversation the panel docks or floats on; defaults to the right. */
  rightPanelSide?: "left" | "right";
}

interface DragHandleProps {
  left: number;
  testId?: string;
  /** Eases the handle along with the grid tracks during a show/hide toggle. */
  animate: boolean;
  onStart(): void;
  onDrag(dx: number): void;
  onEnd(): void;
}

function DragHandle(props: DragHandleProps) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef(0);
  const latest = useRef(0);
  const frame = useRef<number | null>(null);
  const capture = useRef<{ element: HTMLDivElement; id: number } | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;

  const endDrag = useCallback(() => {
    const active = capture.current;
    if (active === null) return;
    capture.current = null;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    if (active.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id);
    setDragging(false);
    callbacks.current.onEnd();
  }, []);
  useEffect(() => endDrag, [endDrag]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || capture.current !== null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    capture.current = { element: e.currentTarget, id: e.pointerId };
    origin.current = e.clientX;
    latest.current = e.clientX;
    callbacks.current.onStart();
    setDragging(true);
  }, []);
  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (capture.current?.id !== e.pointerId) return;
    latest.current = e.clientX;
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null;
      callbacks.current.onDrag(latest.current - origin.current);
    });
  }, []);
  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (capture.current?.id !== e.pointerId) return;
      callbacks.current.onDrag(e.clientX - origin.current);
      endDrag();
    },
    [endDrag],
  );
  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (capture.current?.id === e.pointerId) endDrag();
    },
    [endDrag],
  );

  return (
    <div
      className={clsx(
        "absolute inset-y-0 z-11 -ml-1 w-2 cursor-col-resize touch-none [-webkit-app-region:no-drag]",
        "after:absolute after:inset-y-0 after:left-[3px] after:w-0.5 after:bg-transparent after:content-[''] hover:after:bg-border data-dragging:after:bg-ring",
        props.animate && "transition-[left] duration-(--ds-transition-duration-slow) ease-(--ds-ease-in-out) motion-reduce:transition-none",
      )}
      data-testid={props.testId}
      style={{ left: props.left }}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    />
  );
}

/**
 * Window-drag strip: the top 52px of each column drags the window on macOS; interactive elements inside subtract
 * themselves through the global no-drag rule in app.css. Geometry only, so content under it still receives clicks.
 */
const dragStrip = "pointer-events-none absolute inset-x-0 top-0 h-13";

/**
 * Shell (sidebar | main | optional right panel) ported from DSH ui-layout AppFrame: grid tracks solved by
 * columns.ts, a pointer-capture drag handle on the sidebar edge, eased tracks only on a
 * show/hide toggle, and macOS window chrome (data-platform, vibrancy sidebar, drag strips).
 */
export function AppFrame({
  sidebar,
  main,
  sidebarVisible,
  sidebarWidth,
  onSidebarWidthChange,
  rightPanel = null,
  rightPanelWidth = 0,
  onCanDockChange,
  onRightPanelWidthChange,
  rightPanelSide = "right",
}: AppFrameProps) {
  const panelLeft = rightPanelSide === "left";
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState(0);

  useLayoutEffect(() => {
    document.documentElement.dataset["platform"] = window.omo.platform;
  }, []);

  useLayoutEffect(() => {
    const el = frameRef.current;
    if (el === null) return;
    let raf: number | null = null;
    let disposed = false;
    const measure = (): void => {
      const width = el.getBoundingClientRect().width;
      if (width > 0) setViewport(width);
    };
    measure();
    const observer = new ResizeObserver(() => {
      if (disposed) return;
      raf ??= requestAnimationFrame(() => {
        raf = null;
        measure();
      });
    });
    observer.observe(el);
    return () => {
      disposed = true;
      observer.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  const t = useT();
  const narrow = viewport > 0 && viewport < 800;
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const drawerTrigger = useRef<HTMLElement | null>(null);
  const wasDrawerOpen = useRef(false);
  const drawerOpen = narrow && sidebarDrawerOpen;
  useLayoutEffect(() => {
    sidebarRef.current?.toggleAttribute("inert", narrow ? !drawerOpen : !sidebarVisible);
  }, [narrow, drawerOpen, sidebarVisible]);
  useModalLayer(sidebarRef, drawerOpen, () => setSidebarDrawerOpen(false));
  useEffect(() => {
    if (wasDrawerOpen.current && !drawerOpen && narrow) drawerTrigger.current?.focus();
    wasDrawerOpen.current = drawerOpen;
  }, [drawerOpen, narrow]);
  useEffect(() => {
    if (!narrow) setSidebarDrawerOpen(false);
  }, [narrow]);
  useEffect(() => {
    if (!narrow) return;
    const open = (event: MouseEvent): void => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(`[data-testid="${TESTID.headerSidebarToggle}"]`)) {
        drawerTrigger.current = event.target.closest<HTMLElement>(`[data-testid="${TESTID.headerSidebarToggle}"]`);
        event.preventDefault();
        event.stopPropagation();
        setSidebarDrawerOpen(true);
      } else if (event.target.closest(`[data-testid="${TESTID.sidebarToggle}"]`)) {
        event.preventDefault();
        event.stopPropagation();
        setSidebarDrawerOpen(false);
      } else if (event.target.closest(`[data-testid="${TESTID.threadRow}"], [data-testid="${TESTID.newSession}"], [data-testid="${TESTID.openSettings}"], [data-testid="${TESTID.openAccounts}"]`)) setSidebarDrawerOpen(false);
    };
    const frame = frameRef.current;
    frame?.addEventListener("click", open, true);
    return () => frame?.removeEventListener("click", open, true);
  }, [narrow]);
  const cols = computeColumns(viewport, sidebarVisible && !narrow ? sidebarWidth : 0, rightPanel === null || narrow ? 0 : rightPanelWidth);
  if (rightPanelWidth >= 580 && cols.rightbar > 0 && cols.center < 520) {
    const available = viewport - cols.sidebar - 520;
    cols.rightbar = available >= 300 ? Math.min(cols.rightbar, available) : 0;
    cols.center = viewport - cols.sidebar - cols.rightbar;
  }
  const docked = rightPanel !== null && cols.rightbar > 0;
  const canDock = viewport === 0 || (!narrow && viewport - cols.sidebar - CENTER_MIN >= RIGHTBAR_MIN);
  useEffect(() => { onCanDockChange?.(canDock); }, [canDock, onCanDockChange]);
  // A floating panel that would leave only a sliver of the conversation visible takes the whole width instead.
  const overlayWidth = viewport - rightPanelWidth - 16 < 240 ? viewport - 16 : rightPanelWidth;
  const colsRef = useRef(cols);
  colsRef.current = cols;
  const dragBase = useRef(0);
  const [dragging, setDragging] = useState(false);

  const [animating, setAnimating] = useState(0);
  const previousVisible = useRef(sidebarVisible);
  const previousViewport = useRef(viewport);
  const previousDocked = useRef(docked);
  useLayoutEffect(() => {
    const viewportChanged = previousViewport.current !== viewport;
    previousViewport.current = viewport;
    const visibleChanged = previousVisible.current !== sidebarVisible;
    previousVisible.current = sidebarVisible;
    const dockChanged = previousDocked.current !== docked;
    previousDocked.current = docked;
    if (dockChanged || (visibleChanged && !viewportChanged)) setAnimating((token) => token + 1);
  }, [sidebarVisible, viewport, docked]);
  useEffect(() => {
    if (animating === 0) return;
    const frame = frameRef.current;
    if (frame === null) return;
    const settle = (): void => setAnimating(0);
    const onTransitionEnd = (event: TransitionEvent): void => {
      if (event.target === frame && event.propertyName === "grid-template-columns") settle();
    };
    frame.addEventListener("transitionend", onTransitionEnd);
    const timer = setTimeout(settle, 600);
    return () => {
      frame.removeEventListener("transitionend", onTransitionEnd);
      clearTimeout(timer);
    };
  }, [animating]);

  const onDragStart = useCallback(() => {
    dragBase.current = colsRef.current.sidebar;
    setDragging(true);
  }, []);
  const onDrag = useCallback((dx: number) => onSidebarWidthChange(dragBase.current + dx), [onSidebarWidthChange]);
  const onDragEnd = useCallback(() => setDragging(false), []);
  const rightBase = useRef(0);
  const onRightDragStart = useCallback(() => {
    rightBase.current = colsRef.current.rightbar;
    setDragging(true);
  }, []);
  const onRightDrag = useCallback((dx: number) => {
    const { sidebar } = colsRef.current;
    onRightPanelWidthChange?.(Math.min(viewport - sidebar - CENTER_MIN, Math.max(RIGHTBAR_MIN, rightBase.current + (panelLeft ? dx : -dx))));
  }, [onRightPanelWidthChange, viewport, panelLeft]);

  const easing = animating > 0 && !dragging;

  return (
    <div
      ref={frameRef}
      className={clsx(
        "relative grid h-full grid-rows-[100%] overflow-hidden bg-background",
        easing && "transition-[grid-template-columns] duration-(--ds-transition-duration-slow) ease-(--ds-ease-in-out) motion-reduce:transition-none",
      )}
      data-slot="app-frame"
      style={{ gridTemplateColumns: panelLeft && docked ? `${cols.sidebar}px ${cols.rightbar}px minmax(0px, 1fr)` : `${cols.sidebar}px minmax(0px, 1fr) ${docked ? cols.rightbar : 0}px` }}
      data-testid={TESTID.appFrame}
      data-sidebar-collapsed={narrow || !sidebarVisible || undefined}
      data-narrow={narrow || undefined}
      data-dragging={dragging || undefined}
      data-right-docked={docked || undefined}
      data-panel-side={rightPanelSide}
      data-animating={animating > 0 || undefined}
    >
      {drawerOpen && <button className="absolute inset-0 z-39 m-0 border-0 bg-background/70 p-0 backdrop-blur-xs" tabIndex={-1} aria-hidden="true" onClick={() => setSidebarDrawerOpen(false)} />}
      <div ref={sidebarRef} data-slot={drawerOpen ? "sidebar-drawer" : "sidebar-col"} className={clsx("overflow-hidden border-0 border-r border-solid border-sidebar-border bg-sidebar", drawerOpen ? "absolute inset-y-0 left-0 z-40 w-[min(280px,calc(100%-48px))] shadow-2xl" : "relative min-w-0")} style={drawerOpen ? undefined : { gridColumn: 1, gridRow: 1 }} aria-hidden={narrow ? !drawerOpen : !sidebarVisible} role={drawerOpen ? "dialog" : undefined} aria-modal={drawerOpen || undefined} aria-label={drawerOpen ? t("shell.showSidebar") : undefined}>
        <div className={dragStrip} data-window-drag />
        {sidebar}
      </div>
      <div className="relative flex min-w-0 flex-col overflow-hidden" data-slot="center-col" style={{ gridColumn: panelLeft && docked ? 3 : 2, gridRow: 1 }}>
        <div className={dragStrip} data-window-drag />
        {main}
      </div>
      {rightPanel !== null && (
        <div data-side={rightPanelSide} className={docked
          ? clsx("relative box-border min-w-0 overflow-hidden bg-background py-2", panelLeft ? "pl-2" : "pr-2")
          : clsx("absolute inset-y-2 z-30 max-w-[calc(100%-16px)] rounded-lg shadow-2xl transition-[opacity,translate] duration-(--ds-transition-duration) ease-(--ds-ease-in-out) starting:opacity-0 motion-reduce:transition-none",
            panelLeft ? "left-2 starting:-translate-x-4" : "right-2 starting:translate-x-4")}
          style={docked ? { gridColumn: panelLeft ? 2 : 3, gridRow: 1 } : { width: overlayWidth }}>
          <div className={dragStrip} data-window-drag />
          {rightPanel(docked ? "docked" : "overlay")}
        </div>
      )}
      {sidebarVisible && !narrow && <DragHandle animate={easing} left={cols.sidebar} onStart={onDragStart} onDrag={onDrag} onEnd={onDragEnd} />}
      {docked && onRightPanelWidthChange !== undefined && <DragHandle animate={easing} testId="right-panel-resize" left={panelLeft ? cols.sidebar + cols.rightbar : cols.sidebar + cols.center} onStart={onRightDragStart} onDrag={onRightDrag} onEnd={onDragEnd} />}
    </div>
  );
}
