import type { BrowserWindow } from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { OmoSupervisor } from "../omo/supervisor";
import { readContextUsage } from "./context-usage";
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
}

export function createWorkbenchHandlers(deps: WorkbenchDeps): WorkbenchHandlers {
  const terminals = createTerminals({
    getLoginEnv: () => deps.supervisor.getLoginEnv(),
    send: (channel, payload) => deps.getWindow()?.webContents.send(channel, payload),
  });
  return {
    loadContextUsage: async (sessionPath) => readContextUsage(await readFile(await deps.sessionFile(sessionPath), "utf8")),
    loadNativeCatalog: createNativeCatalog({ supervisor: deps.supervisor }),
    loadDagRuns: async (cwd, id) => loadPersistedDagRuns(
      deps.supervisor.initializeResult?.codexHome ?? path.join(deps.homeDir, ".omo", "agent"), await workspace(cwd), threadId(id),
    ),
    ...terminals,
  };
}
