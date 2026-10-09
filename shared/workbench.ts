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

export interface TerminalChunk {
  threadId: string;
  stream: TerminalStream;
  text: string;
}

export interface TerminalExit {
  threadId: string;
  code: number | null;
}

export interface TerminalSnapshot {
  threadId: string;
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
  /** Returns the existing shell for `threadId` or starts one in `cwd`, which must be an existing absolute directory. */
  terminalOpen(threadId: string, cwd: string): Promise<TerminalSnapshot>;
  terminalWrite(threadId: string, line: string): Promise<void>;
  terminalKill(threadId: string): Promise<void>;
  onTerminalChunk(listener: (chunk: TerminalChunk) => void): () => void;
  onTerminalExit(listener: (exit: TerminalExit) => void): () => void;
}
