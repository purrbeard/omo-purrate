import { uiState } from "../ui-state";
import { terminalLayout, terminalsOf } from "../terminal/terminal-layout";

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
 * Adds a new terminal to the active session's thread, shows it where the user keeps terminals (bottom drawer or side
 * panel) and types `command` into that shell alone. Terminals are numbered, not titled, so `title` is unused.
 * @returns false when no session is open to host a shell
 */
export async function openTerminalCommand({ title, command }: TerminalCommand): Promise<boolean> {
  void title;
  const target = resolveTarget();
  if (target === null) return false;
  terminalLayout.newTerminal(target.threadId);
  const terminalId = terminalsOf(target.threadId).activeTerminalId;
  if (terminalLayout.get().placement === "side") uiState.setRightTab("terminal");
  else terminalLayout.setOpen(target.threadId, true);
  await window.omo.terminalOpen(target.threadId, terminalId, target.cwd);
  await window.omo.terminalWrite(target.threadId, terminalId, `${command}\r`);
  return true;
}
