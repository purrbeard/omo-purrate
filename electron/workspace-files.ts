import { execFile } from "node:child_process";
import { open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { SessionCommit, SessionWorktree, WorkspaceDocument, WorkspaceFile } from "../shared/workspace";

const exec = promisify(execFile);
const MAX_FILES = 2_000;
const MAX_BYTES = 1024 * 1024;
// Git's well-known empty tree: what a repository without commits is compared against.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

async function workspaceRoot(cwd: string): Promise<string> {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) throw new Error("Workspace must be an absolute directory");
  const root = await realpath(cwd);
  if (!(await stat(root)).isDirectory()) throw new Error("Workspace is not a directory");
  return root;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** Check both lexical and canonical boundaries, including ancestors of deleted files. */
async function workspacePath(cwd: string, relativePath: string, allowMissing = false) {
  const root = await workspaceRoot(cwd);
  if (typeof relativePath !== "string" || relativePath === "" || relativePath.includes("\0")
    || path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)
    || /^[a-z]:/i.test(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
    throw new Error("File path must stay inside the workspace");
  }
  const normalized = relativePath.replaceAll("\\", "/");
  const target = path.resolve(root, normalized);
  if (!inside(root, target) || target === root) throw new Error("File path must stay inside the workspace");
  let candidate = target;
  for (;;) {
    try {
      const canonical = await realpath(candidate);
      if (!inside(root, canonical)) throw new Error("File symlink points outside the workspace");
      break;
    } catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      candidate = path.dirname(candidate);
    }
  }
  return { root, target, relativePath: path.relative(root, target).split(path.sep).join("/") };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["--literal-pathspecs", "-C", cwd, ...args], {
    encoding: "utf8", windowsHide: true, maxBuffer: 16 * MAX_BYTES,
  });
  return stdout;
}

type LineCount = Pick<WorkspaceFile, "additions" | "deletions">;

/** The HEAD commit, or "" in a repository without commits. */
async function headCommit(root: string): Promise<string> {
  // --verify --quiet prints nothing and exits 1 when there is no commit yet; any other failure still throws.
  return (await git(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === 1) return "";
    throw error;
  })).trim();
}

async function trackedLineCounts(root: string): Promise<Map<string, LineCount>> {
  const head = await headCommit(root);
  const numstat = await git(root, ["diff", "--numstat", "-z", "--no-renames", "--relative", head === "" ? EMPTY_TREE : head, "--", "."]);
  const counts = new Map<string, LineCount>();
  for (const record of numstat.split("\0")) {
    const [added, removed, file] = record.split("\t");
    if (file === undefined || added === undefined || removed === undefined) continue;
    counts.set(file, { additions: added === "-" ? null : Number(added), deletions: removed === "-" ? null : Number(removed) });
  }
  return counts;
}

/** An untracked file is all additions: its line count, or null when it is binary or too large to read. */
async function untrackedLineCount(file: string): Promise<LineCount> {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    if (size > MAX_BYTES) return { additions: null, deletions: null };
    const bytes = Buffer.alloc(size);
    await handle.read(bytes, 0, size, 0);
    if (bytes.includes(0)) return { additions: null, deletions: null };
    let lines = 0;
    for (const byte of bytes) if (byte === 10) lines++;
    if (size > 0 && bytes[size - 1] !== 10) lines++;
    return { additions: lines, deletions: 0 };
  } finally {
    await handle.close();
  }
}

function visible(file: string): boolean {
  return file !== "" && !file.split("/").some((part) => part === "node_modules" || part === ".git" || part === "..");
}

export async function listWorkspaceFiles(cwd: string): Promise<WorkspaceFile[]> {
  const root = await workspaceRoot(cwd);
  try {
    await git(root, ["rev-parse", "--is-inside-work-tree"]);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("not a git repository")) throw error;
    const files: WorkspaceFile[] = [];
    const directories = [""];
    while (directories.length > 0 && files.length < MAX_FILES) {
      const directory = directories.pop()!;
      const entries = await readdir(path.join(root, directory), { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const relative = directory === "" ? entry.name : `${directory}/${entry.name}`;
        if (!visible(relative) || entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) directories.push(relative);
        else if (entry.isFile()) files.push({ path: relative, status: "" });
        if (files.length === MAX_FILES) break;
      }
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }
  const [prefix, porcelain, files, counts] = await Promise.all([
    git(root, ["rev-parse", "--show-prefix"]),
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]),
    git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."]),
    trackedLineCounts(root),
  ]);
  const statuses = new Map<string, string>();
  const entries = porcelain.split("\0");
  const workspacePrefix = prefix.trimEnd();
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    const repositoryPath = entry.slice(3);
    if (status.includes("R") || status.includes("C")) index++;
    if (!repositoryPath.startsWith(workspacePrefix)) continue;
    const file = repositoryPath.slice(workspacePrefix.length);
    if (visible(file)) statuses.set(file, status.trim());
  }
  const paths = new Set([...statuses.keys(), ...files.split("\0").filter(visible)]);
  const listed = [...paths].map((file) => ({ path: file, status: statuses.get(file) ?? "" }))
    .sort((a, b) => Number(b.status !== "") - Number(a.status !== "") || a.path.localeCompare(b.path))
    .slice(0, MAX_FILES);
  return Promise.all(listed.map(async (file): Promise<WorkspaceFile> => {
    if (file.status === "") return file;
    if (file.status === "??") return { ...file, ...(await untrackedLineCount(path.join(root, file.path))) };
    return { ...file, ...(counts.get(file.path) ?? { additions: 0, deletions: 0 }) };
  }));
}

function count(value: string): number | null {
  return value === "-" ? null : Number(value);
}

/** Hashes reachable from `revision` (only along first parents when `firstParent`) and committed since `sinceMs`. */
async function revisionsSince(root: string, revision: string, sinceMs: number, firstParent: boolean): Promise<Set<string>> {
  const list = await git(root, ["rev-list", ...(firstParent ? ["--first-parent"] : []), `--since-as-filter=@${Math.floor(sinceMs / 1000)}`, revision, "--"]);
  return new Set(list.split("\n").map((line) => line.trim()).filter(Boolean));
}

/** Commits since `sinceMs` on a worktree's HEAD (on the base worktree: only its own first-parent line), with per-file line counts. */
async function commitsSince(root: string, sinceMs: number, firstParent: boolean): Promise<SessionCommit[]> {
  if (await headCommit(root) === "") return [];
  const log = await git(root, ["log", ...(firstParent ? ["--first-parent"] : []), `--since-as-filter=@${Math.floor(sinceMs / 1000)}`, "-z", "--format=%H%x00%s", "HEAD", "--"]);
  const commits: SessionCommit[] = [];
  const entries = log.split("\0");
  for (let index = 0; index + 1 < entries.length; index += 2) {
    const hash = entries[index];
    const subject = entries[index + 1];
    if (!hash || subject === undefined) continue;
    const numstat = await git(root, ["show", "--format=", "--numstat", "-z", "--no-renames", hash, "--"]);
    const files = numstat.split("\0").flatMap((record) => {
      const first = record.indexOf("\t");
      const second = record.indexOf("\t", first + 1);
      return first < 0 || second < 0 ? [] : [{ path: record.slice(second + 1), additions: count(record.slice(0, first)), deletions: count(record.slice(first + 1, second)) }];
    });
    commits.push({ hash, subject, files });
  }
  return commits;
}

/**
 * The work a session did across every worktree of its repository: commits since the session started, and uncommitted
 * changes in worktrees other than the session folder (whose own changes the file list already shows).
 * Commits belong to the branch that made them: the main worktree lists its own first-parent line (merge commits
 * included, merged-in branch commits not), and every other worktree lists the commits its branch made that are not on
 * that line, each flagged with whether the main worktree's branch already contains it.
 */
export async function listSessionWork(cwd: string, sinceMs: number): Promise<SessionWorktree[]> {
  if (!Number.isFinite(sinceMs)) throw new Error("sinceMs must be a number");
  const root = await workspaceRoot(cwd);
  let listing: string;
  try {
    listing = await git(root, ["worktree", "list", "--porcelain", "-z"]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("not a git repository")) return [];
    throw error;
  }
  const top = await realpath((await git(root, ["rev-parse", "--show-toplevel"])).trim());
  const worktrees: Array<{ root: string; branch: string | null; base: boolean }> = [];
  let baseHead: string | null = null;
  let baseBranch: string | null = null;
  let first = true;
  for (const block of listing.split("\0\0")) {
    const lines = block.split("\0");
    const location = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    if (location === undefined || lines.includes("bare")) continue;
    const branch = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length).replace(/^refs\/heads\//, "") ?? null;
    // git lists the main worktree first; the others branch off it and merge back into its branch.
    const base = first;
    first = false;
    if (base) {
      baseHead = lines.find((line) => line.startsWith("HEAD "))?.slice("HEAD ".length) ?? null;
      baseBranch = branch;
    }
    // A worktree whose folder was deleted stays listed until `git worktree prune`; there is nothing to read.
    const resolved = await realpath(location).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    });
    if (resolved !== null) worktrees.push({ root: resolved, branch, base });
  }
  const unborn = baseHead === null || /^0+$/.test(baseHead);
  const baseLine = unborn ? new Set<string>() : await revisionsSince(root, baseHead!, sinceMs, true);
  const inBase = unborn ? new Set<string>() : await revisionsSince(root, baseHead!, sinceMs, false);
  // Ownership follows git's worktree order (main first), never which worktree this session happens to be in, so a
  // commit reachable from two branches lands in the same group wherever the panel is opened. Without a record of
  // which branch created a commit, a shared ancestor goes to the first worktree that lists it, and a fast-forward
  // merge puts a branch's commits on the main line.
  const seen = new Set<string>();
  const result: SessionWorktree[] = [];
  for (const worktree of worktrees) {
    const current = worktree.root === top;
    const own = (await commitsSince(worktree.root, sinceMs, worktree.base))
      .filter((commit) => !seen.has(commit.hash) && (worktree.base || !baseLine.has(commit.hash)));
    const commits = worktree.base ? own : own.map((commit) => ({ ...commit, merged: inBase.has(commit.hash) }));
    for (const commit of commits) seen.add(commit.hash);
    const changes = current ? [] : (await listWorkspaceFiles(worktree.root)).filter((file) => file.status !== "");
    if (current || commits.length > 0 || changes.length > 0) result.push({ ...worktree, current, baseBranch, commits, changes });
  }
  return result.sort((a, b) => Number(b.current) - Number(a.current));
}

const LANGUAGES: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  json: "json", css: "css", scss: "scss", html: "html", md: "markdown", py: "python", rs: "rust",
  go: "go", java: "java", c: "c", h: "c", cpp: "cpp", cs: "csharp", sh: "shell", ps1: "powershell",
  yml: "yaml", yaml: "yaml", toml: "toml", sql: "sql", xml: "xml", swift: "swift", kt: "kotlin",
};

export async function readWorkspaceFile(cwd: string, relativePath: string): Promise<WorkspaceDocument> {
  const resolved = await workspacePath(cwd, relativePath);
  const file = await open(resolved.target, "r");
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("Path is not a regular file");
    if (info.size > MAX_BYTES) throw new Error("File exceeds the 1 MB preview limit");
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > MAX_BYTES) throw new Error("File exceeds the 1 MB preview limit");
    const content = bytes.subarray(0, length);
    if (content.includes(0)) throw new Error("Binary files cannot be previewed");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw new Error("Binary or non-UTF-8 files cannot be previewed");
    }
    return { path: resolved.relativePath, text, language: LANGUAGES[path.extname(resolved.target).slice(1).toLowerCase()] ?? "text" };
  } finally {
    await file.close();
  }
}

export async function getWorkspaceDiff(cwd: string, relativePath: string): Promise<string> {
  const resolved = await workspacePath(cwd, relativePath, true);
  const args = ["--no-ext-diff", "--no-textconv", "--no-color"];
  const [working, staged, status] = await Promise.all([
    git(resolved.root, ["diff", ...args, "--", resolved.relativePath]),
    git(resolved.root, ["diff", "--cached", ...args, "--", resolved.relativePath]),
    git(resolved.root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", resolved.relativePath]),
  ]);
  if (status.startsWith("?? ")) {
    const document = await readWorkspaceFile(resolved.root, resolved.relativePath);
    const lines = document.text.split("\n");
    const newline = document.text.endsWith("\n");
    if (newline || document.text === "") lines.pop();
    const header = `diff --git a/${document.path} b/${document.path}\nnew file mode 100644\n--- /dev/null\n+++ b/${document.path}\n`;
    if (lines.length === 0) return header;
    return `${header}@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}\n${newline ? "" : "\\ No newline at end of file\n"}`;
  }
  return [staged && `# Staged changes\n${staged}`, working && `# Working tree changes\n${working}`].filter(Boolean).join("\n");
}
