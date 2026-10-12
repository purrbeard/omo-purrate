import { useEffect, useRef, useState } from "react";
import type { ComponentType, KeyboardEvent, ReactNode } from "react";
import { IconPanelLeftOutlineRegular, IconAgentPresetOutlineRegular, IconBranchOutlineRegular, IconCodeOutlineRegular, IconFolderOpenOutlineRegular, IconNewChatOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import { useT } from "../../i18n";
import { useActions } from "../app-context";
import { uiState, useUiState } from "../ui-state";
import type { RightTab } from "../ui-state";
import css from "./RightDock.module.css";

const LABELS = {
  agents: "activity.agents",
  btw: "btw.title",
  terminal: "shell.dock.terminal",
  workflow: "activity.workflow",
  files: "shell.workspace.files",
} as const;

const ICONS: Record<RightTab, ComponentType<{ size?: number; className?: string }>> = {
  agents: IconAgentPresetOutlineRegular,
  btw: IconNewChatOutlineRegular,
  terminal: IconCodeOutlineRegular,
  workflow: IconBranchOutlineRegular,
  files: IconFolderOpenOutlineRegular,
};

export function RightDock({ tab, placement, children }: { tab: RightTab; placement: "docked" | "overlay"; children: ReactNode }) {
  const t = useT();
  const actions = useActions();
  const tabs = useRef<Partial<Record<RightTab, HTMLButtonElement | null>>>({});
  const { tabOrder, dockSide } = useUiState();
  const [dragged, setDragged] = useState<RightTab | null>(null);
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
  return (
    <div className={css.dock} data-testid="right-dock" data-placement={placement} data-tab={tab}>
      <div className={css.bar}>
      <div className={css.strip} role="tablist" aria-label={t("shell.dock.tabs")} onKeyDown={onKeyDown}>
        {tabOrder.map((id) => {
          const Icon = ICONS[id];
          return (
            <button key={id} ref={(node) => { tabs.current[id] = node; }} type="button" role="tab" className={css.tab} title={t(LABELS[id])}
              data-testid={`right-tab-${id}`} aria-selected={id === tab} tabIndex={id === tab ? 0 : -1} onClick={() => select(id)}
              draggable data-dragging={dragged === id || undefined} data-drop-target={dropTarget === id && dragged !== id || undefined}
              onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); setDragged(id); }}
              onDragOver={(event) => { if (dragged === null) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(id); }}
              onDragLeave={() => setDropTarget((current) => (current === id ? null : current))}
              onDrop={(event) => { event.preventDefault(); if (dragged !== null) uiState.moveTab(dragged, id); setDragged(null); setDropTarget(null); }}
              onDragEnd={() => { setDragged(null); setDropTarget(null); }}>
              <Icon size={14} className={css.tabIcon} />
              <span className={css.tabLabel}>{t(LABELS[id])}</span>
            </button>
          );
        })}
      </div>
      <button type="button" className={css.close} data-testid="right-dock-side" data-side={dockSide}
        aria-label={t(dockSide === "right" ? "shell.dock.moveLeft" : "shell.dock.moveRight")} title={t(dockSide === "right" ? "shell.dock.moveLeft" : "shell.dock.moveRight")}
        onClick={() => uiState.setDockSide(dockSide === "right" ? "left" : "right")}>
        <IconPanelLeftOutlineRegular size={14} className={dockSide === "left" ? css.mirrored : undefined} />
      </button>
      <button type="button" className={css.close} data-testid="right-dock-close" aria-label={t("shell.dock.close")} onClick={close}>×</button>
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
