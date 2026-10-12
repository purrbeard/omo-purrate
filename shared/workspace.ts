/** Workspace-relative paths, with Git porcelain status (empty for unchanged files). */
export interface WorkspaceFile {
  path: string;
  status: string;
  /** Lines added and removed against the last commit, for changed files; null for binary files. */
  additions?: number | null;
  deletions?: number | null;
}

export interface SessionCommitFile {
  path: string;
  /** Null for binary files. */
  additions: number | null;
  deletions: number | null;
}

export interface SessionCommit {
  hash: string;
  subject: string;
  files: SessionCommitFile[];
  /** For a commit of a branch other than the base: whether the base branch already contains it. Absent on base commits. */
  merged?: boolean;
}

/** One worktree of the session's repository: commits made since the session started and, for worktrees other than the session folder, uncommitted changes. */
export interface SessionWorktree {
  root: string;
  branch: string | null;
  current: boolean;
  /** True for the repository's main worktree, whose branch the other worktrees merge into. */
  base: boolean;
  /** The main worktree's branch (null when detached), the target the merged flags refer to. */
  baseBranch: string | null;
  commits: SessionCommit[];
  changes: WorkspaceFile[];
}

export interface WorkspaceDocument {
  path: string;
  text: string;
  language: string;
}
