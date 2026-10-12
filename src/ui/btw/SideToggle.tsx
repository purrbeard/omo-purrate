import { useEffect } from "react";
import { IconPanelLeftOutlineRegular, Tooltip } from "@deepseek-ai/dsh-client-ui-primitives";
import { useT } from "../../i18n";
import { selectSidesOf } from "../../state";
import { useActions, useAppSelector } from "../app-context";
import { TESTID } from "../testids";
import { shownTab, uiState, useUiState } from "../ui-state";
import css from "./SidePanel.module.css";

/** Ctrl+E (⌘E on macOS) toggles the side chat panel from anywhere in the window (the Aside browser's Ask Aside shortcut). */
export function useSidePanelShortcut(): void {
  const actions = useActions();
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      const modifier = window.omo.platform === "darwin" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!modifier || event.altKey || event.shiftKey || event.isComposing) return;
      if (event.key.toLowerCase() !== "e") return;
      event.preventDefault();
      actions.setSidePanel(shownTab(uiState.get()) !== "btw");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions]);
}
