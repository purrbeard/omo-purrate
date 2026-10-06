import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** omo's own interactive sign-in command for a provider; other providers use the general `/login` picker. */
export function loginCommand(provider: string): string {
  if (provider === "anthropic-subscription") return "/claude-account add";
  if (provider === "chatgpt-subscription") return "/gpt-account add";
  return "/login";
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;
const appleScriptString = (value: string): string => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/** The AppleScript that opens a Terminal window running `omoPath` with the sign-in command as its first input. */
export function loginScript(omoPath: string, provider: string): string {
  const command = `cd ~ && ${shellQuote(omoPath)} ${shellQuote(loginCommand(provider))}`;
  return `tell application "Terminal"\nactivate\ndo script ${appleScriptString(command)}\nend tell`;
}

/** Runs a program with arguments and resolves when it exits successfully. */
export type RunFile = (file: string, args: string[]) => Promise<unknown>;

/** Opens omo in Terminal for an interactive sign-in; omo stores the account itself. */
export async function openLogin(omoPath: string, provider: string, run: RunFile = execFileAsync): Promise<void> {
  await run("/usr/bin/osascript", ["-e", loginScript(omoPath, provider)]);
}
