import { app, Menu, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import type { MenuCommand } from "../shared/ipc";

const GITHUB_URL = "https://github.com/code-yeongyu/oh-my-openagent";

/** Installs the macOS application menu; custom items call sendCommand. */
export function installApplicationMenu(sendCommand: (command: MenuCommand) => void): void {
  const developerItems: MenuItemConstructorOptions[] = app.isPackaged
    ? []
    : [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }];
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => sendCommand("settings") },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Session", accelerator: "CmdOrCtrl+N", click: () => sendCommand("new-session") },
        { type: "separator" },
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
        { label: "Toggle Sidebar", accelerator: "CmdOrCtrl+\\", click: () => sendCommand("toggle-sidebar") },
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
      submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }],
    },
    {
      role: "help",
      submenu: [{ label: "omo on GitHub", click: () => void shell.openExternal(GITHUB_URL) }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
