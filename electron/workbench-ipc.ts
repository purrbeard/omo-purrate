import { ipcMain } from "electron";
import { WORKBENCH_IPC } from "../shared/workbench";
import type { WorkbenchHandlers } from "./workbench/handlers";

export function registerWorkbenchIpc(handlers: WorkbenchHandlers): () => void {
  const table: Record<string, (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown> = {
    [WORKBENCH_IPC.loadContextUsage]: (_event, sessionPath) => handlers.loadContextUsage(sessionPath),
    [WORKBENCH_IPC.loadNativeCatalog]: (_event, cwd, force) => handlers.loadNativeCatalog(cwd, force === true),
    [WORKBENCH_IPC.loadDagRuns]: (_event, cwd, threadId) => handlers.loadDagRuns(cwd, threadId),
    [WORKBENCH_IPC.terminalOpen]: (_event, threadId, cwd) => handlers.terminalOpen(threadId, cwd),
    [WORKBENCH_IPC.terminalWrite]: (_event, threadId, line) => handlers.terminalWrite(threadId, line),
    [WORKBENCH_IPC.terminalKill]: (_event, threadId) => handlers.terminalKill(threadId),
  };
  for (const [channel, handler] of Object.entries(table)) ipcMain.handle(channel, handler);
  return () => {
    for (const channel of Object.keys(table)) ipcMain.removeHandler(channel);
  };
}
