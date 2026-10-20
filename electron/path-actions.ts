import { appendFile, stat } from "node:fs/promises";
import path from "node:path";
import { isDangerousPath, MAX_STAT_PATHS } from "../shared/media";
import type { OpenPathOutcome, PathInfo } from "../shared/media";

/** What the main process can do to a path; injected so the policy is testable without Electron. */
export interface PathActionDeps {
  /** Electron's shell.openPath: resolves "" on success, otherwise the failure text. */
  openPath(target: string): Promise<string>;
  /** Electron's shell.showItemInFolder. */
  showItemInFolder(target: string): void;
  /** When set, actions are appended here as JSON lines instead of launching anything (tests and QA). */
  qaLog?: string | undefined;
}

function absoluteTarget(value: unknown): string {
  if (typeof value !== "string" || value === "" || value.includes("\0")) throw new TypeError("path must be a non-empty string");
  if (!path.isAbsolute(value)) throw new TypeError(`path must be absolute: ${value}`);
  return path.normalize(value);
}

/**
 * Whether each path exists and what it is, in request order. Non-absolute or unreadable paths report missing.
 * @param paths - At most MAX_STAT_PATHS candidates; extras are reported missing.
 */
export async function statPaths(paths: unknown): Promise<PathInfo[]> {
  if (!Array.isArray(paths)) throw new TypeError("paths must be an array");
  return Promise.all(paths.map(async (candidate, index): Promise<PathInfo> => {
    if (index >= MAX_STAT_PATHS || typeof candidate !== "string" || !path.isAbsolute(candidate) || candidate.includes("\0")) return { kind: "missing" };
    try {
      const info = await stat(path.normalize(candidate));
      return info.isDirectory() ? { kind: "dir" } : info.isFile() ? { kind: "file", size: info.size } : { kind: "missing" };
    } catch (error) {
      void error;
      return { kind: "missing" };
    }
  }));
}

/**
 * Open a path with the OS default app (directories open in the file manager). Executables and scripts are never
 * launched: they are revealed in their folder instead.
 * @throws when the path is not absolute, does not exist, or the OS refuses to open it.
 */
export async function openLocalPath(value: unknown, deps: PathActionDeps): Promise<OpenPathOutcome> {
  const target = absoluteTarget(value);
  let isDirectory: boolean;
  try {
    isDirectory = (await stat(target)).isDirectory();
  } catch (error) {
    void error;
    throw new Error(`Path does not exist: ${target}`);
  }
  const outcome: OpenPathOutcome = !isDirectory && isDangerousPath(target) ? "revealed" : "opened";
  if (deps.qaLog !== undefined) {
    await appendFile(deps.qaLog, `${JSON.stringify({ action: outcome === "opened" ? "open" : "reveal", path: target })}\n`);
    return outcome;
  }
  if (outcome === "revealed") {
    deps.showItemInFolder(target);
    return outcome;
  }
  const failure = await deps.openPath(target);
  if (failure !== "") throw new Error(failure);
  return outcome;
}
