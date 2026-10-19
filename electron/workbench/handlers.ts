import type { DagRun } from "../../shared/protocol";
import type { ContextUsage, NativeCatalog, TerminalSnapshot } from "../../shared/workbench";

export interface WorkbenchHandlers {
  loadContextUsage(sessionPath: unknown): Promise<ContextUsage>;
  loadNativeCatalog(cwd: unknown, force: boolean): Promise<NativeCatalog>;
  loadDagRuns(cwd: unknown, threadId: unknown): Promise<DagRun[]>;
  terminalOpen(threadId: unknown, terminalId: unknown, cwd: unknown): Promise<TerminalSnapshot>;
  terminalWrite(threadId: unknown, terminalId: unknown, line: unknown): Promise<void>;
  terminalResize(threadId: unknown, terminalId: unknown, cols: unknown, rows: unknown): Promise<void>;
  terminalKill(threadId: unknown, terminalId: unknown): Promise<void>;
  dispose(): Promise<void>;
}
