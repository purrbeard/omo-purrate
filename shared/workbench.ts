import type { DagRun } from "./protocol";

/** `tokens` is null while unknown, e.g. after a compaction until the next assistant reply reports usage. */
export interface ContextUsage {
  tokens: number | null;
  provider: string | null;
  model: string | null;
  compacted: boolean;
}

export interface NativeCommand {
  name: string;
  description: string;
  source: "extension" | "prompt" | "skill";
  syntax: "slash" | "dollar";
}

export interface NativeCatalog {
  commands: NativeCommand[];
  /** Keyed by `${provider}/${id}`, e.g. `opencodex/gpt-6.1-sol`. */
  contextWindows: Record<string, number>;
  error: string | null;
}

export type TerminalStream = "stdout" | "stderr" | "system";

/** Shells are keyed by thread and terminal: a thread may hold several terminals. */
export interface TerminalChunk {
  threadId: string;
  terminalId: string;
  sequence: number;
  stream: TerminalStream;
  text: string;
}

export interface TerminalExit {
  threadId: string;
  terminalId: string;
  code: number | null;
}

export interface TerminalSnapshot {
  threadId: string;
  terminalId: string;
  sequence: number;
  windowsBuild?: number;
  cwd: string;
  running: boolean;
  output: TerminalChunk[];
}

export const WORKBENCH_IPC = {
  loadContextUsage: "workbench:context-usage",
  loadNativeCatalog: "workbench:native-catalog",
  loadDagRuns: "workbench:dag-runs",
  terminalOpen: "terminal:open",
  terminalWrite: "terminal:write",
  terminalResize: "terminal:resize",
  terminalKill: "terminal:kill",
  terminalChunk: "terminal:chunk",
  terminalExit: "terminal:exit",
} as const;

export interface WorkbenchBridgeApi {
  /** `sessionPath` must resolve inside the omo sessions directory. */
  loadContextUsage(sessionPath: string): Promise<ContextUsage>;
  loadNativeCatalog(cwd: string, force?: boolean): Promise<NativeCatalog>;
  /** Persisted native runs whose `parentSessionId` is `threadId`, newest first, in the live wire shape. */
  loadDagRuns(cwd: string, threadId: string): Promise<DagRun[]>;
  /**
   * Returns the existing shell for (`threadId`, `terminalId`) or starts one in `cwd`, which must be an existing absolute
   * directory.
   */
  terminalOpen(threadId: string, terminalId: string, cwd: string): Promise<TerminalSnapshot>;
  /** Writes raw keystrokes, including control characters, without adding a newline. */
  terminalWrite(threadId: string, terminalId: string, data: string): Promise<void>;
  terminalResize(threadId: string, terminalId: string, cols: number, rows: number): Promise<void>;
  terminalKill(threadId: string, terminalId: string): Promise<void>;
  onTerminalChunk(listener: (chunk: TerminalChunk) => void): () => void;
  onTerminalExit(listener: (exit: TerminalExit) => void): () => void;
}
