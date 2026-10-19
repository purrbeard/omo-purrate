import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import clsx from "clsx";
import { ArrowLeftRight, Bot, FileDiff, FolderOpen, MessagesSquare, SquareTerminal, Workflow, X, type LucideIcon } from "lucide-react";
import { modalSelector } from "@deepseek-ai/dsh-client-ui-primitives";
import { useT, type MessageKey } from "../../i18n";
import { selectMainThreadId, selectSidesOf, useAppStore } from "../../state";
import { toggleTerminal } from "../terminal/terminal-layout";
import { useActions, useAppSelector } from "../app-context";
import { focusRing, IconButton, Tooltip } from "../kit";
import { uiState, useUiState } from "../ui-state";
import type { RightTab } from "../ui-state";

const LABELS = {
  work: "activity.work",
  btw: "btw.title",
  terminal: "shell.dock.terminal",
  files: "shell.workspace.files",
} as const;

const ICONS: Record<RightTab, LucideIcon> = {
  work: Workflow,
  btw: MessagesSquare,
  terminal: SquareTerminal,
  files: FolderOpen,
};

const tabClass = clsx(
  "relative m-0 box-border inline-flex h-7 min-w-0 flex-[1_1_auto] cursor-pointer items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-md",
  "border border-solid border-transparent bg-transparent px-2.5 text-xs font-medium text-muted-foreground [font-family:inherit]",
  "transition-colors duration-150 motion-reduce:transition-none hover:bg-accent hover:text-foreground",
  "aria-selected:border-border aria-selected:bg-background aria-selected:font-semibold aria-selected:text-foreground aria-selected:shadow-sm",
  // The selected tab carries the dock's single primary mark.
  "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary after:opacity-0 after:content-[''] aria-selected:after:opacity-100",
  "data-dragging:opacity-50 data-drop-target:ring-1 data-drop-target:ring-ring",
  "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
  "[&_svg]:size-3.5 [&_svg]:shrink-0",
);

/**
 * The side panel frame: a tab strip whose tabs always keep their icon and name (a narrow dock drops the visible name
 * but keeps it as the tooltip and accessible name), the side switch and the close button. With `tab` null the dock
 * shows its surface launcher.
 */
export function RightDock({ tab, placement, children }: { tab: RightTab | null; placement: "docked" | "overlay"; children: ReactNode }) {
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
  const label = t(tab === null ? "shell.dock.launcher.title" : LABELS[tab]);
  const select = (next: RightTab): void => {
    if (next === "btw") actions.setSidePanel(true);
    else uiState.setRightTab(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = tab === null ? -1 : tabOrder.indexOf(tab);
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
    else if (tab === null) uiState.setRightTab(null);
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
  const sideLabel = t(dockSide === "right" ? "shell.dock.moveLeft" : "shell.dock.moveRight");
  return (
    <div ref={dockRef} className="flex h-full min-h-0 min-w-0 flex-col gap-1.5" data-testid="right-dock" data-placement={placement} data-tab={tab ?? "launcher"}
      role={placement === "overlay" ? "dialog" : undefined} aria-modal={placement === "overlay" ? true : undefined} aria-label={placement === "overlay" ? label : undefined}
      onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); close(); } else trapTab(event); }}>
      <div className="flex min-w-0 shrink-0 items-center gap-0.5 rounded-lg border border-solid border-border bg-card pr-0.5">
        <div className="@container flex min-w-0 flex-1 gap-0.5 overflow-x-auto p-1 [scrollbar-width:none]" role="tablist" aria-label={t("shell.dock.tabs")} onKeyDown={onKeyDown}>
          {tabOrder.map((id, index) => {
            const Icon = ICONS[id];
            const name = t(LABELS[id]);
            return (
              <Tooltip.Root key={id}>
                <Tooltip.Trigger
                  ref={(node: HTMLButtonElement | null) => { tabs.current[id] = node; }}
                  render={
                    <button type="button" role="tab" className={tabClass} aria-label={id === "btw" && sideCount > 0 ? `${name} ${sideCount}` : name}
                      data-testid={`right-tab-${id}`} aria-selected={id === tab} tabIndex={id === tab || (tab === null && index === 0) ? 0 : -1} onClick={() => select(id)}
                      draggable data-dragging={dragged === id || undefined} data-drop-target={dropTarget === id && dragged !== id || undefined}
                      onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); draggedRef.current = id; setDragged(id); }}
                      onDragOver={(event) => { if (draggedRef.current === null) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(id); }}
                      onDragLeave={() => setDropTarget((current) => (current === id ? null : current))}
                      onDrop={(event) => { event.preventDefault(); const source = draggedRef.current; if (source !== null) uiState.moveTab(source, id); endDrag(); }}
                      onDragEnd={endDrag} />
                  }
                >
                  <Icon aria-hidden />
                  {/* A dock too narrow for every name keeps only the selected tab's name, and the narrowest drops that too;
                      the icon, tooltip and accessible name stay. */}
                  <span className={`min-w-0 truncate ${id === tab ? "@max-[300px]:hidden" : "@max-[440px]:hidden"}`}>{name}</span>
                  {id === "btw" && sideCount > 0 && <span className="shrink-0 tabular-nums text-muted-foreground" data-testid="side-count">{sideCount}</span>}
                </Tooltip.Trigger>
                <Tooltip.Content side="bottom">{name}</Tooltip.Content>
              </Tooltip.Root>
            );
          })}
        </div>
        <Tooltip.Root>
          <Tooltip.Trigger render={<IconButton icon={<ArrowLeftRight />} label={sideLabel} data-testid="right-dock-side" data-side={dockSide} onClick={() => uiState.setDockSide(dockSide === "right" ? "left" : "right")} />} />
          <Tooltip.Content side="bottom">{sideLabel}</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger ref={closeRef} render={<IconButton icon={<X />} label={t("shell.dock.close")} data-testid="right-dock-close" onClick={close} />} />
          <Tooltip.Content side="bottom" align="end">{t("shell.dock.close")}</Tooltip.Content>
        </Tooltip.Root>
      </div>
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  );
}

interface Surface {
  id: string;
  key: string;
  icon: LucideIcon;
  label: MessageKey;
  open(): void;
}

const SURFACES: readonly Surface[] = [
  { id: "terminal", key: "T", icon: SquareTerminal, label: "shell.dock.terminal", open: () => uiState.setRightTab("terminal") },
  { id: "files", key: "F", icon: FolderOpen, label: "shell.workspace.files", open: () => uiState.openFiles("all") },
  { id: "changes", key: "C", icon: FileDiff, label: "shell.dock.surface.changes", open: () => uiState.openFiles("changes") },
  { id: "agents", key: "A", icon: Bot, label: "activity.agents", open: () => uiState.openWork("agents") },
];

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']") !== null);
}

/**
 * The empty dock: one list of surfaces, each opened by a click or by its single key while focus is not in a text
 * field or a modal.
 */
export function DockLauncher() {
  const t = useT();
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing || event.repeat) return;
      if (isEditable(event.target) || document.querySelector(modalSelector) !== null) return;
      const surface = SURFACES.find((entry) => entry.key.toLowerCase() === event.key.toLowerCase());
      if (surface === undefined) return;
      event.preventDefault();
      surface.open();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <section className="box-border flex h-full flex-col items-center justify-center gap-4 rounded-lg border border-solid border-border bg-card p-6" data-testid="dock-launcher" aria-labelledby="dock-launcher-title">
      <div className="flex w-full max-w-64 flex-col gap-1">
        <h2 id="dock-launcher-title" className="m-0 mb-2 text-center text-sm font-semibold text-foreground">{t("shell.dock.launcher.title")}</h2>
        {SURFACES.map(({ id, key, icon: Icon, label, open }) => (
          <button key={id} type="button" data-testid={`dock-surface-${id}`} aria-keyshortcuts={key} onClick={open}
            className={clsx("m-0 box-border flex h-9 w-full cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-3 text-left text-sm text-foreground [font-family:inherit] hover:bg-accent", focusRing)}>
            <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{t(label)}</span>
            <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-solid border-border px-1 font-mono text-xs text-muted-foreground" aria-label={t("shell.dock.surface.shortcut", { key })}>{key}</kbd>
          </button>
        ))}
        <p className="m-0 mt-2 text-center text-xs text-muted-foreground">{t("shell.dock.launcher.hint")}</p>
      </div>
    </section>
  );
}

/** Ctrl+` (Command+` on macOS) toggles the terminal dock; the terminal hands this key back to the app instead of the shell. */
export function isTerminalShortcut(event: globalThis.KeyboardEvent): boolean {
  const modifier = window.omo.platform === "darwin" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return modifier && !event.altKey && !event.shiftKey && !event.isComposing && event.code === "Backquote";
}

export function useTerminalShortcut(): void {
  const store = useAppStore();
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (!isTerminalShortcut(event)) return;
      event.preventDefault();
      toggleTerminal(selectMainThreadId(store.getState()));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store]);
}
