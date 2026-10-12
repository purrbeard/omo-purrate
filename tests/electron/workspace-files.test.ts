import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rename, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { getWorkspaceDiff, listSessionWork, listWorkspaceFiles, readWorkspaceFile } from "../../electron/workspace-files";

const exec = promisify(execFile);

async function repository() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "omo-workspace-files-"));
  const git = (...args: string[]) => exec("git", ["-C", cwd, ...args], { windowsHide: true });
  await git("init", "--quiet");
  await git("config", "core.autocrlf", "false");
  return { cwd, git };
}

describe("workspace files", () => {
  it("includes recent worktree commits and pending files but excludes older commits", async () => {
    const { cwd, git } = await repository();
    await git("config", "user.name", "test");
    await git("config", "user.email", "test@example.test");
    await writeFile(path.join(cwd, "base.txt"), "base\n");
    await git("add", ".");
    const commit = (root: string, date: string) => exec("git", ["-C", root, "commit", "-m", "fixture"], { windowsHide: true, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
    await commit(cwd, "2020-01-01T00:00:00Z");
    const child = `${cwd}-child`;
    await git("worktree", "add", "-b", "child", child);
    await writeFile(path.join(child, "한글 file.ts"), "one\ntwo\n");
    await writeFile(path.join(child, "binary.bin"), Buffer.from([0, 1]));
    await exec("git", ["-C", child, "add", "."]);
    await commit(child, "2025-01-01T00:00:00Z");
    await writeFile(path.join(child, "pending.txt"), "pending\n");
    const work = await listSessionWork(cwd, Date.parse("2024-01-01T00:00:00Z"));
    const other = work.find((entry) => entry.branch === "child");
    expect(work.flatMap((entry) => entry.commits)).toHaveLength(1);
    expect(other?.commits[0]?.files).toEqual(expect.arrayContaining([
      { path: "한글 file.ts", additions: 2, deletions: 0 },
      { path: "binary.bin", additions: null, deletions: null },
    ]));
    expect(other?.changes).toEqual([{ path: "pending.txt", status: "??", additions: 1, deletions: 0 }]);
  });

  it("returns no commits for an empty repository and no worktrees for a non-Git directory", async () => {
    const { cwd } = await repository();
    expect((await listSessionWork(cwd, 0)).flatMap((entry) => entry.commits)).toEqual([]);
    const plain = await mkdtemp(path.join(os.tmpdir(), "omo-session-plain-"));
    expect(await listSessionWork(plain, 0)).toEqual([]);
  });
  it("lists and reads a plain workspace without requiring Git", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "omo-workspace-plain-"));
    await mkdir(path.join(cwd, "folder"));
    await mkdir(path.join(cwd, "node_modules"));
    await writeFile(path.join(cwd, "folder", "note.txt"), "plain-workspace");
    await writeFile(path.join(cwd, "node_modules", "excluded.txt"), "dependency");
    expect(await listWorkspaceFiles(cwd)).toEqual([{ path: "folder/note.txt", status: "" }]);
    expect((await readWorkspaceFile(cwd, "folder/note.txt")).text).toBe("plain-workspace");
  });
  it("lists actual tracked and untracked files, status first, without ignored or dependency files", async () => {
    const { cwd, git } = await repository();
    await writeFile(path.join(cwd, ".gitignore"), "ignored.txt\n");
    await writeFile(path.join(cwd, "tracked.ts"), "export const value = 1;\n");
    await git("add", ".gitignore", "tracked.ts");
    await writeFile(path.join(cwd, "tracked.ts"), "export const value = 2;\n");
    await writeFile(path.join(cwd, "new file.ts"), "const fresh = true;\n");
    await writeFile(path.join(cwd, "ignored.txt"), "hidden\n");
    await mkdir(path.join(cwd, "node_modules"));
    await writeFile(path.join(cwd, "node_modules", "dependency.js"), "ignored dependency\n");
    const files = await listWorkspaceFiles(cwd);
    expect(files).toEqual(expect.arrayContaining([
      { path: "tracked.ts", status: "AM", additions: 1, deletions: 0 },
      { path: "new file.ts", status: "??", additions: 1, deletions: 0 },
    ]));
    expect(files.some((file) => /ignored|node_modules|\.git\//.test(file.path))).toBe(false);
    expect(files.every((file) => !path.isAbsolute(file.path))).toBe(true);
  });

  it("keeps paths relative to the selected workspace when it is a Git subdirectory", async () => {
    const { cwd, git } = await repository();
    const subdir = path.join(cwd, "nested");
    await mkdir(subdir);
    await writeFile(path.join(subdir, "one.ts"), "one\n");
    await writeFile(path.join(cwd, "outside.ts"), "outside\n");
    await git("add", ".");
    expect(await listWorkspaceFiles(subdir)).toEqual([{ path: "one.ts", status: "A", additions: 1, deletions: 0 }]);
  });

  it("counts changed lines against the last commit, including deletions and binary files", async () => {
    const { cwd, git } = await repository();
    await writeFile(path.join(cwd, "edited.ts"), "one\ntwo\nthree\n");
    await writeFile(path.join(cwd, "removed.ts"), "a\nb\n");
    await git("add", ".");
    await git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "base");
    await writeFile(path.join(cwd, "edited.ts"), "one\n2\nthree\nfour\nfive");
    await git("rm", "--quiet", "removed.ts");
    await writeFile(path.join(cwd, "image.bin"), Buffer.from([0, 1, 2, 0]));
    const changed = (await listWorkspaceFiles(cwd)).filter((file) => file.status !== "");
    expect(changed).toEqual(expect.arrayContaining([
      { path: "edited.ts", status: "M", additions: 3, deletions: 1 },
      { path: "removed.ts", status: "D", additions: 0, deletions: 2 },
      { path: "image.bin", status: "??", additions: null, deletions: null },
    ]));
    expect(changed).toHaveLength(3);
  });

  it("reads UTF-8 code as safe text and reports its language", async () => {
    const { cwd } = await repository();
    const text = "export const text = '<script>alert(1)</script>';\n";
    await writeFile(path.join(cwd, "example.ts"), text);
    expect(await readWorkspaceFile(cwd, "example.ts")).toEqual({ path: "example.ts", text, language: "typescript" });
  });

  it("rejects traversal, absolute paths and symlinks outside the canonical workspace", async () => {
    const { cwd } = await repository();
    const outside = await mkdtemp(path.join(os.tmpdir(), "omo-workspace-outside-"));
    await writeFile(path.join(outside, "secret.txt"), "private\n");
    await symlink(outside, path.join(cwd, "external"), process.platform === "win32" ? "junction" : "dir");
    for (const candidate of ["../secret.txt", "..\\secret.txt", path.join(outside, "secret.txt"), "C:\\secret.txt", "C:secret.txt", "external/secret.txt"]) {
      await expect(readWorkspaceFile(cwd, candidate)).rejects.toThrow(/workspace/i);
      await expect(getWorkspaceDiff(cwd, candidate)).rejects.toThrow(/workspace/i);
    }
    await expect(getWorkspaceDiff(cwd, "external/missing.txt")).rejects.toThrow(/outside the workspace/);
  });

  it("permits a symlink that resolves inside the workspace", async () => {
    const { cwd } = await repository();
    const internal = path.join(cwd, "internal");
    await mkdir(internal);
    await writeFile(path.join(internal, "code.ts"), "const internal = true;\n");
    await symlink(internal, path.join(cwd, "alias"), process.platform === "win32" ? "junction" : "dir");
    expect((await readWorkspaceFile(cwd, "alias/code.ts")).text).toBe("const internal = true;\n");
  });

  it("rejects directories, oversized files and binary contents", async () => {
    const { cwd } = await repository();
    await writeFile(path.join(cwd, "large.txt"), Buffer.alloc(1024 * 1024 + 1, 97));
    await writeFile(path.join(cwd, "binary.bin"), Buffer.from([65, 0, 66]));
    await writeFile(path.join(cwd, "non-utf8.bin"), Buffer.from([0xff, 0xfe]));
    await mkdir(path.join(cwd, "directory"));
    await expect(readWorkspaceFile(cwd, "large.txt")).rejects.toThrow(/1 MB/);
    await expect(readWorkspaceFile(cwd, "binary.bin")).rejects.toThrow(/Binary/);
    await expect(readWorkspaceFile(cwd, "non-utf8.bin")).rejects.toThrow(/Binary/);
    await expect(readWorkspaceFile(cwd, "directory")).rejects.toThrow();
  });

  it("returns actual staged and working-tree changes using literal Git path arguments", async () => {
    const { cwd, git } = await repository();
    const file = "odd [name] & dollar$.ts";
    await writeFile(path.join(cwd, file), "const value = 1;\n");
    await git("add", "--", file);
    await writeFile(path.join(cwd, file), "const value = 2;\n");
    const diff = await getWorkspaceDiff(cwd, file);
    expect(diff).toContain("# Staged changes");
    expect(diff).toContain("+const value = 1;");
    expect(diff).toContain("# Working tree changes");
    expect(diff).toContain("-const value = 1;");
    expect(diff).toContain("+const value = 2;");
  });

  it("renders an untracked file as additions and keeps missing-final-newline information", async () => {
    const { cwd } = await repository();
    await writeFile(path.join(cwd, "new.ts"), "const first = 1;\nconst second = 2;");
    const diff = await getWorkspaceDiff(cwd, "new.ts");
    expect(diff).toContain("--- /dev/null\n+++ b/new.ts");
    expect(diff).toContain("@@ -0,0 +1,2 @@\n+const first = 1;\n+const second = 2;");
    expect(diff).toContain("\\ No newline at end of file");
  });

  it("shows a deletion diff even when the file no longer exists", async () => {
    const { cwd, git } = await repository();
    await writeFile(path.join(cwd, "removed.ts"), "const removed = true;\n");
    await git("add", "removed.ts");
    await rename(path.join(cwd, "removed.ts"), path.join(cwd, "moved.ts"));
    expect(await getWorkspaceDiff(cwd, "removed.ts")).toContain("-const removed = true;");
  });
  it("attributes worktree commits to their own branch and flags whether the main branch contains them", async () => {
    const { cwd, git } = await repository();
    await git("config", "user.name", "test");
    await git("config", "user.email", "test@example.test");
    await git("checkout", "-q", "-b", "main");
    await writeFile(path.join(cwd, "base.txt"), "base\n");
    await git("add", ".");
    const at = (root: string, date: string, ...args: string[]) => exec("git", ["-C", root, ...args], { windowsHide: true, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
    await at(cwd, "2020-01-01T00:00:00Z", "commit", "-q", "-m", "old");
    const child = `${cwd}-feat`;
    await git("worktree", "add", "-q", "-b", "feat", child);
    await writeFile(path.join(child, "one.txt"), "1\n");
    await at(child, "2030-01-01T00:00:00Z", "add", ".");
    await at(child, "2030-01-01T00:00:00Z", "commit", "-q", "-m", "feat-merged");
    await at(cwd, "2030-01-02T00:00:00Z", "merge", "-q", "--no-ff", "feat", "-m", "merge feat");
    await writeFile(path.join(child, "two.txt"), "2\n");
    await at(child, "2030-01-03T00:00:00Z", "add", ".");
    await at(child, "2030-01-03T00:00:00Z", "commit", "-q", "-m", "feat-pending");
    const since = Date.parse("2029-12-31T00:00:00Z");
    for (const from of [cwd, child]) {
      const work = await listSessionWork(from, since);
      const main = work.find((entry) => entry.branch === "main")!;
      const feat = work.find((entry) => entry.branch === "feat")!;
      expect(main).toMatchObject({ base: true, baseBranch: "main" });
      expect(main.commits.map((commit) => [commit.subject, commit.merged])).toEqual([["merge feat", undefined]]);
      expect(feat).toMatchObject({ base: false, baseBranch: "main", current: from === child });
      expect(feat.commits.map((commit) => [commit.subject, commit.merged])).toEqual([["feat-pending", false], ["feat-merged", true]]);
    }
  });
  it("keeps a commit shared by two worktree branches in one group wherever the panel is opened", async () => {
    const { cwd, git } = await repository();
    await git("config", "user.name", "test");
    await git("config", "user.email", "test@example.test");
    await git("checkout", "-q", "-b", "main");
    await writeFile(path.join(cwd, "base.txt"), "base\n");
    await git("add", ".");
    const at = (root: string, date: string, ...args: string[]) => exec("git", ["-C", root, ...args], { windowsHide: true, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
    await at(cwd, "2020-01-01T00:00:00Z", "commit", "-q", "-m", "old");
    const first = `${cwd}-a`;
    await git("worktree", "add", "-q", "-b", "feat-a", first);
    await writeFile(path.join(first, "a.txt"), "a\n");
    await at(first, "2030-01-01T00:00:00Z", "add", ".");
    await at(first, "2030-01-01T00:00:00Z", "commit", "-q", "-m", "shared");
    const second = `${cwd}-b`;
    await git("worktree", "add", "-q", "-b", "feat-b", second, "feat-a");
    await writeFile(path.join(second, "b.txt"), "b\n");
    await at(second, "2030-01-02T00:00:00Z", "add", ".");
    await at(second, "2030-01-02T00:00:00Z", "commit", "-q", "-m", "only-b");
    const since = Date.parse("2029-12-31T00:00:00Z");
    // The session's own worktree is always listed, even without commits; compare only the groups that hold commits.
    const groups = async (from: string) => Object.fromEntries((await listSessionWork(from, since)).filter((work) => work.commits.length > 0).map((work) => [work.branch, work.commits.map((commit) => commit.subject)]));
    const fromA = await groups(first);
    expect(fromA).toEqual(await groups(second));
    expect(fromA).toEqual(await groups(cwd));
    expect(fromA["feat-a"]).toEqual(["shared"]);
    expect(fromA["feat-b"]).toEqual(["only-b"]);
    expect((await listSessionWork(second, since))[0]?.current).toBe(true);
  });
});
