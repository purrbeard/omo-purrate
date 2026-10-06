import { stat } from "node:fs/promises";
import path from "node:path";
import type { OpenTarget, OpenTargetId } from "../shared/ipc";
import { OPEN_TARGET_IDS } from "../shared/ipc";

/** Runs a program with arguments and resolves its stdout; rejects when the process fails. */
export type ExecFn = (file: string, args: readonly string[]) => Promise<string>;

export interface OpenWorkspaceDeps {
  exec: ExecFn;
  /** `shell.openPath` for the Finder target. */
  openPath: (target: string) => Promise<string>;
  /** `fs.stat`, injectable for tests. */
  statPath?: (target: string) => Promise<{ isDirectory(): boolean }>;
}

interface EditorSpec {
  id: Exclude<OpenTargetId, "finder" | "terminal">;
  bundleId: string;
}

const EDITORS: readonly EditorSpec[] = [
  { id: "vscode", bundleId: "com.microsoft.VSCode" },
  { id: "cursor", bundleId: "com.todesktop.230313mzl4w4u92" },
];

const MDFIND = "/usr/bin/mdfind";
const OPEN = "/usr/bin/open";
const TERMINAL_APP = "Terminal";

export function isOpenTargetId(value: unknown): value is OpenTargetId {
  return OPEN_TARGET_IDS.some((id) => id === value);
}

async function requireDirectory(cwd: unknown, statPath: NonNullable<OpenWorkspaceDeps["statPath"]>): Promise<string> {
  if (typeof cwd !== "string" || cwd === "") throw new TypeError("cwd must be a non-empty string");
  if (!path.isAbsolute(cwd)) throw new Error("cwd must be an absolute path");
  let info: { isDirectory(): boolean };
  try {
    info = await statPath(cwd);
  } catch (error) {
    throw new Error(`cwd does not exist: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!info.isDirectory()) throw new Error("cwd is not a directory");
  return cwd;
}

/** Spotlight lookup by bundle id; an app is installed when mdfind prints at least one path. */
async function isInstalled(exec: ExecFn, bundleId: string): Promise<boolean> {
  try {
    const out = await exec(MDFIND, [`kMDItemCFBundleIdentifier == '${bundleId}'`]);
    return out.trim() !== "";
  } catch (error) {
    console.warn(`mdfind could not look up ${bundleId}; treating it as not installed`, error);
    return false;
  }
}

/** Opening targets for the header's Open menu: every installed editor, Terminal when present, and Finder always. */
export function createOpenWorkspace(deps: OpenWorkspaceDeps) {
  const statPath = deps.statPath ?? stat;

  const listTargets = async (): Promise<OpenTarget[]> => {
    const editors = await Promise.all(EDITORS.map(async (editor) => ({ editor, installed: await isInstalled(deps.exec, editor.bundleId) })));
    const targets: OpenTarget[] = editors.filter((entry) => entry.installed).map((entry) => ({ id: entry.editor.id }));
    if (await isInstalled(deps.exec, "com.apple.Terminal")) targets.push({ id: "terminal" });
    targets.push({ id: "finder" });
    return targets;
  };

  const open = async (cwd: unknown, target: unknown): Promise<void> => {
    if (!isOpenTargetId(target)) throw new TypeError(`unknown open target: ${String(target)}`);
    const dir = await requireDirectory(cwd, statPath);
    if (target === "finder") {
      const problem = await deps.openPath(dir);
      if (problem !== "") throw new Error(problem);
      return;
    }
    if (target === "terminal") {
      await deps.exec(OPEN, ["-a", TERMINAL_APP, dir]);
      return;
    }
    const editor = EDITORS.find((entry) => entry.id === target);
    if (editor === undefined) throw new TypeError(`unknown open target: ${target}`);
    if (!(await isInstalled(deps.exec, editor.bundleId))) throw new Error(`${target} is not installed`);
    await deps.exec(OPEN, ["-b", editor.bundleId, dir]);
  };

  /** The primary action: the first installed editor in preference order, else Finder. */
  const openDefault = async (cwd: unknown): Promise<OpenTargetId> => {
    const targets = await listTargets();
    const chosen = targets.find((entry) => entry.id !== "terminal")?.id ?? "finder";
    await open(cwd, chosen);
    return chosen;
  };

  return { listTargets, open, openDefault };
}

export type OpenWorkspace = ReturnType<typeof createOpenWorkspace>;
