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

export type ShortcutOverrides = Record<string, string>;
export const EDITABLE_SHORTCUTS = new Set(["command-palette", "command-palette-alternate"]);

function parseBinding(value: string): string[] | null {
  const match = /^(?:CmdOrCtrl|Ctrl|Cmd)\+(Shift\+)?([A-Z])$/i.exec(value.trim());
  const key = match?.[2];
  return key === undefined ? null : ["Ctrl", ...(match?.[1] === undefined ? [] : ["Shift"]), key.toUpperCase()];
}

export function parseShortcutOverrides(value: unknown): ShortcutOverrides | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const result: ShortcutOverrides = {};
  for (const [id, binding] of Object.entries(value)) {
    if (!EDITABLE_SHORTCUTS.has(id) || typeof binding !== "string") return null;
    const keys = parseBinding(binding);
    if (keys === null) return null;
    result[id] = keys.join("+").replace(/^Ctrl/, "CmdOrCtrl");
  }
  return result;
}

export function shortcutOverridesError(value: unknown): "invalid" | "collision" | null {
  const overrides = parseShortcutOverrides(value);
  if (overrides === null) return "invalid";
  // Native Edit/Window roles must keep their standard meaning too.
  const occupied = new Set(["CTRL+A", "CTRL+C", "CTRL+V", "CTRL+X", "CTRL+Z", "CTRL+Y", "CTRL+SHIFT+Z", "CTRL+SHIFT+V", "CTRL+W", "CTRL+Q", "CTRL+R", "CTRL+SHIFT+I", "CTRL+M", "CTRL+H", "CTRL+F"]);
  for (const shortcut of APP_SHORTCUTS) {
    const signature = shortcutKeys(shortcut, "other", overrides).join("+").toUpperCase();
    if (occupied.has(signature)) return "collision";
    occupied.add(signature);
  }
  return null;
}

export function shortcutKeys(shortcut: AppShortcut, platform: string, overrides: ShortcutOverrides = {}): readonly string[] {
  const binding = parseBinding(overrides[shortcut.id] ?? "");
  if (binding === null) return platform === "darwin" ? shortcut.keys.darwin : shortcut.keys.other;
  return platform === "darwin" ? binding.map(key => key === "Ctrl" ? "⌘" : key === "Shift" ? "⇧" : key) : binding;
}

export function rendererShortcut(event: KeyboardEvent, platform: string, overrides: ShortcutOverrides = {}): AppShortcut | undefined {
  const modifier = platform === "darwin" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!modifier || event.altKey || event.isComposing || event.keyCode === 229 || event.repeat || event.defaultPrevented) return undefined;
  return APP_SHORTCUTS.find(shortcut => {
    if (shortcut.owner !== "renderer") return false;
    const keys = shortcutKeys(shortcut, platform, overrides);
    if (event.shiftKey !== (keys.includes("Shift") || keys.includes("⇧"))) return false;
    const key = keys.at(-1);
    return shortcut.id === "session-number" ? /^[1-9]$/.test(event.key) : key?.toLowerCase() === event.key.toLowerCase();
  });
}
