import { ipcMain } from "electron";
import { BROWSER_IPC } from "../../shared/browser";
import type { BrowserColorScheme, BrowserDevice, BrowserZoom } from "../../shared/browser";
import { browserRect, pageUrl } from "./browser-host";
import type { BrowserHost } from "./browser-host";
import { listLocalServers } from "./local-servers";

function oneOf<T extends string>(allowed: readonly T[], value: unknown, name: string): T {
  const match = allowed.find((entry) => entry === value);
  if (match === undefined) throw new Error(`Invalid ${name}`);
  return match;
}

/** Registers the browser dock channels; every argument is validated here before it reaches the host. */
export function registerBrowserIpc(host: BrowserHost): () => void {
  const table: Record<string, (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown> = {
    [BROWSER_IPC.show]: (_event, rect) => host.show(browserRect(rect)),
    [BROWSER_IPC.hide]: () => host.hide(),
    [BROWSER_IPC.snapshot]: () => host.snapshot(),
    [BROWSER_IPC.navigate]: (_event, url) => host.navigate(pageUrl(url)),
    [BROWSER_IPC.back]: () => host.back(),
    [BROWSER_IPC.forward]: () => host.forward(),
    [BROWSER_IPC.reload]: (_event, hard) => host.reload(hard === true),
    [BROWSER_IPC.devtools]: () => host.openDevTools(),
    [BROWSER_IPC.colorScheme]: (_event, scheme) => host.setColorScheme(oneOf<BrowserColorScheme>(["system", "light", "dark"], scheme, "color scheme")),
    [BROWSER_IPC.zoom]: (_event, direction) => host.zoom(oneOf<BrowserZoom>(["in", "out", "reset"], direction, "zoom direction")),
    [BROWSER_IPC.device]: (_event, device) => host.setDevice(oneOf<BrowserDevice>(["desktop", "tablet", "mobile"], device, "device")),
    [BROWSER_IPC.clearCookies]: () => host.clearCookies(),
    [BROWSER_IPC.clearCache]: () => host.clearCache(),
    [BROWSER_IPC.screenshot]: () => host.screenshot(),
    [BROWSER_IPC.copyImage]: (_event, file) => host.copyImage(file),
    [BROWSER_IPC.pick]: () => host.pick(),
    [BROWSER_IPC.cancelPick]: () => host.cancelPick(),
    [BROWSER_IPC.localServers]: () => listLocalServers(),
  };
  for (const [channel, handler] of Object.entries(table)) ipcMain.handle(channel, handler);
  return () => {
    for (const channel of Object.keys(table)) ipcMain.removeHandler(channel);
  };
}
