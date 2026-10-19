import { ipcMain } from "electron";
import { SERVERS_IPC } from "../../shared/servers";
import type { ServersHost } from "./servers-host";

/** Registers the servers dock channels; the host refuses any alias that is not in the ssh config. */
export function registerServersIpc(host: ServersHost): () => void {
  const table: Record<string, (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown> = {
    [SERVERS_IPC.list]: () => host.list(),
    [SERVERS_IPC.test]: (_event, alias) => host.test(alias),
    [SERVERS_IPC.refresh]: (_event, alias) => host.refresh(alias),
  };
  for (const [channel, handler] of Object.entries(table)) ipcMain.handle(channel, handler);
  return () => {
    for (const channel of Object.keys(table)) ipcMain.removeHandler(channel);
  };
}
