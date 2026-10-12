import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ComponentType, KeyboardEvent, ReactNode } from "react";
import { IconPanelLeftOutlineRegular, IconBranchOutlineRegular, IconCodeOutlineRegular, IconFolderOpenOutlineRegular, IconNewChatOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import { useT } from "../../i18n";
import { selectSidesOf } from "../../state";
import { useActions, useAppSelector } from "../app-context";
import { shownTab, uiState, useUiState } from "../ui-state";
import type { RightTab } from "../ui-state";
import css from "./RightDock.module.css";

const LABELS = {
  work: "activity.work",
  btw: "btw.title",
  terminal: "shell.dock.terminal",
  files: "shell.workspace.files",
} as const;

const ICONS: Record<RightTab, ComponentType<{ size?: number; className?: string }>> = {
  work: IconBranchOutlineRegular,
  btw: IconNewChatOutlineRegular,
  terminal: IconCodeOutlineRegular,
  files: IconFolderOpenOutlineRegular,
};

export function RightDock({ tab, placement, children }: { tab: RightTab; placement: "docked" | "overlay"; children: ReactNode }) {
  const t = useT();
  const actions = useActions();
  const tabs = useRef<Partial<Record<RightTab, HTMLButtonElement | null>>>({});
  const { tabOrder, dockSide } = useUiState();
  const sideCount = useAppSelector((state) => selectSidesOf(state, state.activeThreadId).length);
  const [dragged, setDragged] = useState<RightTab | null>(null);
  // dragover can fire before React re-renders after dragstart, so the handlers read the dragged tab from a ref.
  const draggedRef = useRef<RightTab | null>(null);
  const endDrag = (): void => { draggedRef.current = null; setDragged(null); setDropTarget(null); };
  const [dropTarget, setDropTarget] = useState<RightTab | null>(null);
  const select = (next: RightTab): void => {
    if (next === "btw") actions.setSidePanel(true);
    else uiState.setRightTab(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = tabOrder.indexOf(tab);
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const target = delta !== 0 ? tabOrder[(index + delta + tabOrder.length) % tabOrder.length]
      : event.key === "Home" ? tabOrder[0] : event.key === "End" ? tabOrder.at(-1) : undefined;
    if (target === undefined) return;
    event.preventDefault();
    select(target);
    tabs.current[target]?.focus();
  };
  const close = (): void => {
    if (tab === "btw") actions.setSidePanel(false);
    else uiState.closeRightTab(tab);
  };
  // One close path for every tab: the bar's close button and Escape inside the dock (a panel may claim Escape first).
  const dockRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The opener is read before the panel's own effects move focus into it, and gets focus back when the dock closes.
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && dockRef.current?.contains(active) !== true) opener.current = active;
    return () => { if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    if (placement === "overlay" && dockRef.current?.contains(document.activeElement) !== true) closeRef.current?.focus();
  }, [placement]);
  /** A floating dock keeps Tab inside it; hidden, disabled and collapsed controls are skipped. */
  const trapTab = (event: KeyboardEvent<HTMLDivElement>): void => {
    const root = dockRef.current;
    if (placement !== "overlay" || event.key !== "Tab" || root === null) return;
    const controls = [...root.querySelectorAll<HTMLElement>('button, summary, [tabindex], input, select, textarea, a[href]')].filter(control => {
      if (control.tabIndex < 0 || control.matches(":disabled") || control.closest("[hidden], [inert]") !== null || control.getClientRects().length === 0) return false;
      const visibility = getComputedStyle(control).visibility;
      if (visibility === "hidden" || visibility === "collapse") return false;
      for (let ancestor = control.parentElement; ancestor !== null && ancestor !== root; ancestor = ancestor.parentElement) {
        if (ancestor instanceof HTMLDetailsElement && !ancestor.open && !ancestor.querySelector(":scope > summary")?.contains(control)) return false;
      }
      return true;
    });
    const first = controls[0];
    const last = controls.at(-1);
    if (first === undefined || last === undefined) { event.preventDefault(); return; }
    const active = document.activeElement as HTMLElement | null;
    if (active === null || !controls.includes(active)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
    if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };
  return (
    <div ref={dockRef} className={css.dock} data-testid="right-dock" data-placement={placement} data-tab={tab}
      role={placement === "overlay" ? "dialog" : undefined} aria-modal={placement === "overlay" ? true : undefined} aria-label={placement === "overlay" ? t(LABELS[tab]) : undefined}
      onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); close(); } else trapTab(event); }}>
      <div className={css.bar}>
      <div className={css.strip} role="tablist" aria-label={t("shell.dock.tabs")} onKeyDown={onKeyDown}>
        {tabOrder.map((id) => {
          const Icon = ICONS[id];
          return (
            <button key={id} ref={(node) => { tabs.current[id] = node; }} type="button" role="tab" className={css.tab} title={t(LABELS[id])}
              data-testid={`right-tab-${id}`} aria-selected={id === tab} tabIndex={id === tab ? 0 : -1} onClick={() => select(id)}
              draggable data-dragging={dragged === id || undefined} data-drop-target={dropTarget === id && dragged !== id || undefined}
              onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); draggedRef.current = id; setDragged(id); }}
              onDragOver={(event) => { if (draggedRef.current === null) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(id); }}
              onDragLeave={() => setDropTarget((current) => (current === id ? null : current))}
              onDrop={(event) => { event.preventDefault(); const source = draggedRef.current; if (source !== null) uiState.moveTab(source, id); endDrag(); }}
              onDragEnd={endDrag}>
              <Icon size={14} className={css.tabIcon} />
              <span className={css.tabLabel}>{t(LABELS[id])}</span>
              {id === "btw" && sideCount > 0 && <span className={css.tabCount} data-testid="side-count">{sideCount}</span>}
            </button>
          );
        })}
      </div>
      <button type="button" className={css.close} data-testid="right-dock-side" data-side={dockSide}
        aria-label={t(dockSide === "right" ? "shell.dock.moveLeft" : "shell.dock.moveRight")} title={t(dockSide === "right" ? "shell.dock.moveLeft" : "shell.dock.moveRight")}
        onClick={() => uiState.setDockSide(dockSide === "right" ? "left" : "right")}>
        <IconPanelLeftOutlineRegular size={14} className={dockSide === "left" ? css.mirrored : undefined} />
      </button>
      <button ref={closeRef} type="button" className={css.close} data-testid="right-dock-close" aria-label={t("shell.dock.close")} title={t("shell.dock.close")} onClick={close}>×</button>
      </div>
      <div className={css.body}>{children}</div>
    </div>
  );
}

export function useTerminalShortcut(): void {
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      const modifier = window.omo.platform === "darwin" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!modifier || event.altKey || event.shiftKey || event.isComposing || event.code !== "Backquote") return;
      event.preventDefault();
      uiState.toggleRightTab("terminal");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
