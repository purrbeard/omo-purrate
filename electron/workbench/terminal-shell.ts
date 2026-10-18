import { constants } from "node:fs";
import { access, lstat, stat } from "node:fs/promises";
import path from "node:path";

interface ShellOptions {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string>>;
  readonly override?: string;
  readonly exists?: (file: string) => Promise<boolean>;
}

/** Resolve executables without invoking another shell or interpolating command text. */
export async function resolveTerminalShell(options: ShellOptions): Promise<{ file: string; args: string[] }> {
  const windows = options.platform === "win32";
  const paths = windows ? path.win32 : path.posix;
  const env = (name: string): string | undefined => Object.entries(options.env)
    .find(([key]) => windows ? key.toLowerCase() === name.toLowerCase() : key === name)?.[1];
  const root = env("SystemRoot") ?? "C:\\Windows";
  const candidates = windows
    ? [options.override, "pwsh.exe", paths.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), "powershell.exe", env("ComSpec"), paths.join(root, "System32", "cmd.exe")]
    : [options.override, env("SHELL"), "/bin/zsh", "/bin/bash", "/bin/sh"];
  const exists = options.exists ?? (async (file: string): Promise<boolean> => {
    try {
      if (windows) { await lstat(file); return /\.exe$/iu.test(file); }
      await access(file, constants.X_OK);
      return (await stat(file)).isFile();
    }
    catch (error) {
      if (error instanceof Error && "code" in error) return false;
      throw error;
    }
  });
  for (const candidate of candidates) {
    if (!candidate) continue;
    const files = paths.isAbsolute(candidate) ? [candidate] : (env("PATH") ?? "").split(windows ? ";" : ":").filter(Boolean).map(dir => paths.join(dir, candidate));
    for (const file of files) {
      if (await exists(file)) return { file, args: /^(?:pwsh|powershell)(?:\.exe)?$/iu.test(paths.basename(file)) ? ["-NoLogo", "-NoExit", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8"] : [] };
    }
  }
  throw new Error("No interactive terminal shell was found");
}
