import { describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import type { MenuCommand } from "../../shared/ipc";
import { buildMenuTemplate, installApplicationMenu } from "../../electron/menu";

vi.mock("electron", () => ({
  app: { name: "OmO UI", isPackaged: false },
  Menu: { buildFromTemplate: (template: unknown) => template, setApplicationMenu: () => {} },
  shell: { openExternal: () => Promise.resolve() },
}));

const ALL_COMMANDS: MenuCommand[] = [
  "new-session", "settings", "toggle-sidebar", "command-palette", "open-project",
  "toggle-agents", "toggle-workflow", "toggle-files", "toggle-terminal", "toggle-side-chat", "keyboard-shortcuts",
];

function build(platform: NodeJS.Platform, isPackaged = true, options: { openLogs?: () => void } = {}) {
  const sendCommand = vi.fn<(command: MenuCommand) => void>();
  const template = buildMenuTemplate(sendCommand, options, platform, isPackaged);
  return { sendCommand, template };
}

/** Every item reachable in the template, depth-first. */
function items(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const found: MenuItemConstructorOptions[] = [];
  for (const item of template) {
    found.push(item);
    if (Array.isArray(item.submenu)) found.push(...items(item.submenu));
  }
  return found;
}

function itemLabeled(template: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions | undefined {
  return items(template).find((item) => item.label === label);
}

function submenuOf(template: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  const found = template.find((item) => item.label === label || item.role === label.toLowerCase());
  return Array.isArray(found?.submenu) ? found.submenu : [];
}

describe("buildMenuTemplate", () => {
  it.each<[NodeJS.Platform]>([["win32"], ["linux"], ["darwin"]])("reaches every MenuCommand on %s", (platform) => {
    const { sendCommand, template } = build(platform);
    for (const item of items(template)) {
      if (typeof item.click === "function") (item.click as () => void)();
    }
    const reached = sendCommand.mock.calls.map(([command]) => command);
    for (const command of ALL_COMMANDS) {
      expect(reached, `unreachable: ${command}`).toContain(command);
    }
  });

  it("routes each command once per click", () => {
    const { sendCommand, template } = build("win32");
    for (const item of items(template)) {
      if (typeof item.click === "function") (item.click as () => void)();
    }
    expect(new Set(sendCommand.mock.calls.map(([command]) => command)).size).toBe(ALL_COMMANDS.length);
  });

  it("wires the documented accelerators", () => {
    const { template } = build("win32");
    const expected: Array<[string, string]> = [
      ["New Session", "CmdOrCtrl+N"],
      ["Open Project…", "CmdOrCtrl+O"],
      ["Settings…", "CmdOrCtrl+,"],
      ["Command Palette", "CmdOrCtrl+K"],
      ["Toggle Sidebar", "CmdOrCtrl+\\"],
      ["Agents", "CmdOrCtrl+Shift+A"],
      ["Workflow", "CmdOrCtrl+Shift+W"],
      ["Files", "CmdOrCtrl+Shift+E"],
      ["Terminal", "CmdOrCtrl+`"],
      ["Side Chat", "CmdOrCtrl+E"],
      ["Keyboard Shortcuts", "CmdOrCtrl+/"],
    ];
    for (const [label, accelerator] of expected) {
      const item = itemLabeled(template, label);
      expect(item, `missing item: ${label}`).toBeDefined();
      expect(item?.accelerator, label).toBe(accelerator);
    }
  });

  it("keeps the Side Chat and Command Palette accelerators unregistered for the renderer", () => {
    const { template } = build("win32");
    expect(itemLabeled(template, "Side Chat")?.registerAccelerator).toBe(false);
    expect(itemLabeled(template, "Command Palette")?.registerAccelerator).toBe(false);
    expect(itemLabeled(template, "Terminal")?.registerAccelerator).toBe(false);
  });

  it("shows Open Logs Folder only when openLogs is provided", () => {
    const openLogs = vi.fn();
    const without = build("win32");
    expect(itemLabeled(without.template, "Open Logs Folder")).toBeUndefined();

    const withLogs = build("win32", true, { openLogs });
    const item = itemLabeled(withLogs.template, "Open Logs Folder");
    expect(item).toBeDefined();
    (item?.click as () => void)();
    expect(openLogs).toHaveBeenCalledTimes(1);
  });

  it("keeps omo on GitHub in Help after a separator", () => {
    const { template } = build("win32");
    const help = submenuOf(template, "help");
    const github = help.findIndex((item) => item.label === "omo on GitHub");
    expect(github).toBeGreaterThan(0);
    expect(help[github - 1]?.type).toBe("separator");
  });

  it("puts Settings in the win32 File menu, not the app menu", () => {
    const { template } = build("win32");
    const file = submenuOf(template, "File");
    expect(file.find((item) => item.label === "Settings…")?.accelerator).toBe("CmdOrCtrl+,");
    const appMenu = template[0];
    const appSubmenu = Array.isArray(appMenu?.submenu) ? appMenu.submenu : [];
    expect(appSubmenu.some((item) => item.label === "Settings…")).toBe(false);
  });

  it("keeps Settings in the darwin app menu and out of File", () => {
    const { template, sendCommand } = build("darwin");
    const appSubmenu = Array.isArray(template[0]?.submenu) ? (template[0].submenu as MenuItemConstructorOptions[]) : [];
    const settings = appSubmenu.find((item) => item.label === "Settings…");
    expect(settings).toBeDefined();
    (settings?.click as () => void)();
    expect(sendCommand).toHaveBeenCalledWith("settings");
    expect(submenuOf(template, "File").some((item) => item.label === "Settings…")).toBe(false);
  });

  it("keeps developer items out of the View menu when packaged", () => {
    const packaged = items(build("win32", true).template).map((item) => item.role);
    expect(packaged).not.toContain("toggleDevTools");
    const unpackaged = items(build("win32", false).template).map((item) => item.role);
    expect(unpackaged).toContain("toggleDevTools");
    expect(unpackaged).toContain("togglefullscreen");
  });
});

describe("installApplicationMenu", () => {
  it("installs the template built for this process", () => {
    const sendCommand = vi.fn<(command: MenuCommand) => void>();
    expect(() => installApplicationMenu(sendCommand, { openLogs: () => {} })).not.toThrow();
  });
});
