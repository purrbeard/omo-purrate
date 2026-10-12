import { app, Menu, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import type { MenuCommand } from "../shared/ipc";

const GITHUB_URL = "https://github.com/code-yeongyu/oh-my-openagent";

/** Optional main-process actions the menu can invoke besides sendCommand. */
export interface MenuOptions {
  /** Opens the app's log folder; the Help item appears only when this is provided. */
  openLogs?: () => void;
}

/**
 * Builds the application menu template; pure so it can be unit-tested without Electron's Menu.
 * Custom items call sendCommand, which the renderer routes per MenuCommand.
 */
export function buildMenuTemplate(
  sendCommand: (command: MenuCommand) => void,
  options: MenuOptions,
  platform: NodeJS.Platform,
  isPackaged: boolean,
): MenuItemConstructorOptions[] {
  const developerItems: MenuItemConstructorOptions[] = isPackaged
    ? []
    : [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }];
  return [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        ...(platform === "darwin"
          ? [
              { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => sendCommand("settings") },
              { type: "separator" as const },
            ]
          : []),
        ...(platform === "darwin" ? [
          { role: "services" as const },
          { type: "separator" as const },
          { role: "hide" as const },
          { role: "hideOthers" as const },
          { role: "unhide" as const },
          { type: "separator" as const },
        ] : []),
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Session", accelerator: "CmdOrCtrl+N", click: () => sendCommand("new-session") },
        { label: "Open Project…", accelerator: "CmdOrCtrl+O", click: () => sendCommand("open-project") },
        { type: "separator" },
        ...(platform === "darwin"
          ? []
          : [
              { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => sendCommand("settings") },
              { type: "separator" as const },
            ]),
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        // The renderer owns Ctrl+K (src/ui/shortcuts.ts) so it also works when the menu accelerator never reaches the page.
        { label: "Command Palette", accelerator: "CmdOrCtrl+K", registerAccelerator: false, click: () => sendCommand("command-palette") },
        { label: "Toggle Sidebar", accelerator: "CmdOrCtrl+\\", click: () => sendCommand("toggle-sidebar") },
        { type: "separator" },
        { label: "Agents", accelerator: "CmdOrCtrl+Shift+A", click: () => sendCommand("toggle-agents") },
        { label: "Workflow", accelerator: "CmdOrCtrl+Shift+W", click: () => sendCommand("toggle-workflow") },
        { label: "Files", accelerator: "CmdOrCtrl+Shift+E", click: () => sendCommand("toggle-files") },
        // The renderer owns Ctrl+` (useTerminalShortcut); a registered accelerator never reaches the page here.
        { label: "Terminal", accelerator: "CmdOrCtrl+`", registerAccelerator: false, click: () => sendCommand("toggle-terminal") },
        // The renderer already handles Ctrl+E itself, so do not register a second global accelerator.
        { label: "Side Chat", accelerator: "CmdOrCtrl+E", registerAccelerator: false, click: () => sendCommand("toggle-side-chat") },
        { type: "separator" },
        ...developerItems,
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      role: "window",
      submenu: platform === "darwin"
        ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
        : [{ role: "minimize" }, { role: "close" }],
    },
    {
      role: "help",
      submenu: [
        { label: "Keyboard Shortcuts", accelerator: "CmdOrCtrl+/", click: () => sendCommand("keyboard-shortcuts") },
        ...(options.openLogs ? [{ label: "Open Logs Folder", click: () => options.openLogs?.() }] : []),
        { type: "separator" },
        { label: "omo on GitHub", click: () => void shell.openExternal(GITHUB_URL) },
      ],
    },
  ];
}

/** Installs platform application menus; custom items call sendCommand. */
export function installApplicationMenu(sendCommand: (command: MenuCommand) => void, options: MenuOptions = {}): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(sendCommand, options, process.platform, app.isPackaged)));
}
