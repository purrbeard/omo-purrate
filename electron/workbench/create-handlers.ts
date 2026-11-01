import type { BrowserWindow } from "electron";
import path from "node:path";
import type { OmoSupervisor } from "../omo/supervisor";
import type { HistoryReader } from "../history/history-reader";
import { loadPersistedDagRuns } from "./dag-runs";
import type { WorkbenchHandlers } from "./handlers";
import { createNativeCatalog } from "./native-catalog";
import { createTerminals } from "./terminal";
import { threadId, workspace } from "./validation";

export interface WorkbenchDeps {
  supervisor: OmoSupervisor;
  homeDir: string;
  getWindow: () => BrowserWindow | null;
  sessionFile: (sessionPath: unknown) => Promise<string>;
  historyReader: HistoryReader;
}

export function createWorkbenchHandlers(deps: WorkbenchDeps): WorkbenchHandlers {
  const terminals = createTerminals({
    getLoginEnv: () => deps.supervisor.getLoginEnv(),
    send: (channel, payload) => deps.getWindow()?.webContents.send(channel, payload),
  });
  return {
    loadContextUsage: async (sessionPath) => deps.historyReader.context(await deps.sessionFile(sessionPath)),
    loadNativeCatalog: createNativeCatalog({ supervisor: deps.supervisor }),
    loadDagRuns: async (cwd, id) => loadPersistedDagRuns(
      deps.supervisor.initializeResult?.codexHome ?? path.join(deps.homeDir, ".omo", "agent"), await workspace(cwd), threadId(id),
    ),
    ...terminals,
  };
}
