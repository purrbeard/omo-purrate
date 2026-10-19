import { ipcMain } from "electron";
import { WORKBENCH_IPC } from "../shared/workbench";
import type { WorkbenchHandlers } from "./workbench/handlers";

export function registerWorkbenchIpc(handlers: WorkbenchHandlers): () => void {
  const table: Record<string, (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown> = {
    [WORKBENCH_IPC.loadContextUsage]: (_event, sessionPath) => handlers.loadContextUsage(sessionPath),
    [WORKBENCH_IPC.loadNativeCatalog]: (_event, cwd, force) => handlers.loadNativeCatalog(cwd, force === true),
    [WORKBENCH_IPC.loadDagRuns]: (_event, cwd, threadId) => handlers.loadDagRuns(cwd, threadId),
    [WORKBENCH_IPC.terminalOpen]: (_event, threadId, terminalId, cwd) => handlers.terminalOpen(threadId, terminalId, cwd),
    [WORKBENCH_IPC.terminalWrite]: (_event, threadId, terminalId, line) => handlers.terminalWrite(threadId, terminalId, line),
    [WORKBENCH_IPC.terminalResize]: (_event, threadId, terminalId, cols, rows) => handlers.terminalResize(threadId, terminalId, cols, rows),
    [WORKBENCH_IPC.terminalKill]: (_event, threadId, terminalId) => handlers.terminalKill(threadId, terminalId),
  };
  for (const [channel, handler] of Object.entries(table)) ipcMain.handle(channel, handler);
  return () => {
    for (const channel of Object.keys(table)) ipcMain.removeHandler(channel);
  };
}
