import { useEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useT } from "../../i18n";
import { useActions } from "../app-context";
import { RIGHT_TABS, uiState } from "../ui-state";
import type { RightTab } from "../ui-state";
import css from "./RightDock.module.css";

const LABELS = {
  agents: "activity.agents",
  btw: "btw.title",
  terminal: "shell.dock.terminal",
  workflow: "activity.workflow",
  files: "shell.workspace.files",
} as const;

export function RightDock({ tab, placement, children }: { tab: RightTab; placement: "docked" | "overlay"; children: ReactNode }) {
  const t = useT();
  const actions = useActions();
  const tabs = useRef<Partial<Record<RightTab, HTMLButtonElement | null>>>({});
  const select = (next: RightTab): void => {
    if (next === "btw") actions.setSidePanel(true);
    else uiState.setRightTab(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = RIGHT_TABS.indexOf(tab);
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const target = delta !== 0 ? RIGHT_TABS[(index + delta + RIGHT_TABS.length) % RIGHT_TABS.length]
      : event.key === "Home" ? RIGHT_TABS[0] : event.key === "End" ? RIGHT_TABS.at(-1) : undefined;
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
        {RIGHT_TABS.map((id) => (
          <button key={id} ref={(node) => { tabs.current[id] = node; }} type="button" role="tab" className={css.tab}
            data-testid={`right-tab-${id}`} aria-selected={id === tab} tabIndex={id === tab ? 0 : -1} onClick={() => select(id)}>
            {t(LABELS[id])}
          </button>
        ))}
      </div>
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
