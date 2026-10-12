import type { MessageKey } from "../i18n";

export interface AppShortcut {
  id: string;
  label: MessageKey;
  keys: { darwin: readonly string[]; other: readonly string[] };
  owner: "menu" | "renderer" | "control";
}

const modified = (key: string, shift = false): AppShortcut["keys"] => ({
  darwin: ["⌘", ...(shift ? ["⇧"] : []), key],
  other: ["Ctrl", ...(shift ? ["Shift"] : []), key],
});

/**
 * Electron owns menu accelerators. Ctrl+` is renderer-owned (RightDock useTerminalShortcut) and listed as a control key.
 * The App renderer registers only Ctrl+K, Ctrl+Shift+P and session numbers; the menu shows Ctrl+K with
 * registerAccelerator false. Registering the panel accelerators here too would toggle panels twice. Existing control-owned keys
 * remain in SideToggle, ModelPicker and Composer and are listed, not registered.
 */
export const APP_SHORTCUTS: readonly AppShortcut[] = [
  { id: "new-session", label: "shell.newSession", keys: modified("N"), owner: "menu" },
  { id: "open-project", label: "shell.palette.openProject", keys: modified("O"), owner: "menu" },
  { id: "settings", label: "shell.openSettings", keys: modified(","), owner: "menu" },
  { id: "command-palette", label: "shell.palette.title", keys: modified("K"), owner: "renderer" },
  { id: "command-palette-alternate", label: "shell.settings.keybindings.paletteAlternate", keys: modified("P", true), owner: "renderer" },
  { id: "session-number", label: "shell.settings.keybindings.session", keys: modified("1-9"), owner: "renderer" },
  { id: "toggle-sidebar", label: "shell.toggleSidebar", keys: modified("\\"), owner: "menu" },
  { id: "toggle-agents", label: "activity.agents", keys: modified("A", true), owner: "menu" },
  { id: "toggle-workflow", label: "activity.workflow", keys: modified("W", true), owner: "menu" },
  { id: "toggle-files", label: "shell.workspace.files", keys: modified("E", true), owner: "menu" },
  { id: "toggle-terminal", label: "shell.dock.terminal", keys: modified("`"), owner: "control" },
  { id: "toggle-side-chat", label: "btw.toggle", keys: modified("E"), owner: "control" },
  { id: "keyboard-shortcuts", label: "shell.settings.nav.keybindings", keys: modified("/"), owner: "menu" },
  { id: "model-picker", label: "shell.settings.nav.model", keys: modified("M", true), owner: "control" },
  { id: "send", label: "composer.send", keys: { darwin: ["Enter"], other: ["Enter"] }, owner: "control" },
  { id: "newline", label: "shell.settings.keybindings.newline", keys: { darwin: ["⇧", "Enter"], other: ["Shift", "Enter"] }, owner: "control" },
];

export function shortcutKeys(shortcut: AppShortcut, platform: string): readonly string[] {
  return platform === "darwin" ? shortcut.keys.darwin : shortcut.keys.other;
}

export function rendererShortcut(event: KeyboardEvent, platform: string): AppShortcut | undefined {
  const modifier = platform === "darwin" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!modifier || event.altKey || event.isComposing || event.repeat || event.defaultPrevented) return undefined;
  return APP_SHORTCUTS.find(shortcut => {
    if (shortcut.owner !== "renderer") return false;
    const keys = shortcutKeys(shortcut, platform);
    if (event.shiftKey !== (keys.includes("Shift") || keys.includes("⇧"))) return false;
    const key = keys.at(-1);
    return shortcut.id === "session-number" ? /^[1-9]$/.test(event.key) : key?.toLowerCase() === event.key.toLowerCase();
  });
}
