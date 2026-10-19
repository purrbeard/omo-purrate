import { uiState } from "../ui-state";

export interface TerminalCommand {
  /** Names the terminal the command runs in once terminals have titles. */
  title: string;
  command: string;
}

type ShellTarget = { threadId: string; cwd: string };

let resolveTarget: () => ShellTarget | null = () => null;

/** The Servers panel registers how to find the thread whose shell runs commands (the main thread of the active session). */
export function setTerminalTarget(resolve: () => ShellTarget | null): void {
  resolveTarget = resolve;
}

/**
 * Opens the terminal and types `command` into it. Today's dock has one shell per thread, so the command runs in the
 * active session's shell and `title` is unused; the terminal-layout track re-points this at a new titled terminal.
 * @returns false when no session is open to host a shell
 */
export async function openTerminalCommand({ title, command }: TerminalCommand): Promise<boolean> {
  void title;
  const target = resolveTarget();
  if (target === null) return false;
  uiState.setRightTab("terminal");
  await window.omo.terminalOpen(target.threadId, target.cwd);
  await window.omo.terminalWrite(target.threadId, `${command}\r`);
  return true;
}
