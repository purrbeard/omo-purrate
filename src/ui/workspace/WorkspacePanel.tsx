import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionWorktree, WorkspaceFile } from "../../../shared/workspace";
import { useT } from "../../i18n";
import { useAppSelector } from "../app-context";
import { GIT_REFRESH_EVENT, selectCompletedTurnCount } from "../git/use-git-info";
import css from "./WorkspacePanel.module.css";


export interface WorkspacePanelProps {
  placement: "docked" | "overlay";
}

export function WorkspacePanel({ placement }: WorkspacePanelProps) {
  const cwd = useAppSelector((state) => state.activeThreadId === null ? null : state.threads[state.activeThreadId]?.cwd ?? null);
  const threadId = useAppSelector((state) => state.activeThreadId);
  return <WorkspaceContents key={threadId ?? "no-workspace"} threadId={threadId} cwd={cwd} placement={placement} />;
}

function WorkspaceContents({ cwd, threadId, placement }: WorkspacePanelProps & { cwd: string | null; threadId: string | null }) {
  const t = useT();
  const labels = Object.fromEntries((["title", "refresh", "changed", "all", "search", "file", "diff", "loading", "empty", "noChanges", "noDiff", "select", "noWorkspace", "readOnly", "tabClose", "error", "binary"] as const)
    .map(key => [key, t(`workspace.panel.${key}`)])) as Record<"title" | "refresh" | "changed" | "all" | "search" | "file" | "diff" | "loading" | "empty" | "noChanges" | "noDiff" | "select" | "noWorkspace" | "readOnly" | "tabClose" | "error" | "binary", string>;
  const [sessionView, setSessionView] = useState(false);
  const [sessionWork, setSessionWork] = useState<SessionWorktree[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const completedTurns = useAppSelector(selectCompletedTurnCount);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [tabs, setTabs] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"file" | "diff">("file");
  const [filter, setFilter] = useState("");
  const [changesOnly, setChangesOnly] = useState(true);
  const [revision, setRevision] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ text: string; language: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!sessionView || cwd === null || threadId === null) return;
    let cancelled = false;
    setSessionLoading(true);
    setSessionError(null);
    void window.omo.request("thread/read", { threadId, includeTurns: false })
      .then(({ thread }) => window.omo.listSessionWork(cwd, thread.createdAt * 1000))
      .then((work) => { if (!cancelled) setSessionWork(work); }, (error: unknown) => {
        if (!cancelled) setSessionError(error instanceof Error ? error.message : String(error));
      }).finally(() => { if (!cancelled) setSessionLoading(false); });
    return () => { cancelled = true; };
  }, [cwd, threadId, sessionView, revision, completedTurns]);

  useEffect(() => {
    const refresh = (): void => setRevision((value) => value + 1);
    window.addEventListener(GIT_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(GIT_REFRESH_EVENT, refresh);
  }, []);

  useEffect(() => {
    if (cwd === null) return;
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    void window.omo.listWorkspaceFiles(cwd).then((next) => {
      if (cancelled) return;
      setFiles(next);
    }, (error: unknown) => {
      if (!cancelled) setListError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) setListLoading(false);
    });
    return () => { cancelled = true; };
  }, [cwd, revision, completedTurns]);

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    if (cwd === null || selected === null) return;
    let cancelled = false;
    setPreviewLoading(true);
    const request = mode === "diff"
      ? window.omo.getWorkspaceDiff(cwd, selected).then((text) => ({ text, language: "diff" }))
      : window.omo.readWorkspaceFile(cwd, selected);
    void request.then((document) => {
      if (!cancelled) setPreview(document);
    }, (error: unknown) => {
      if (!cancelled) setPreviewError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) setPreviewLoading(false);
    });
    return () => { cancelled = true; };
  }, [cwd, selected, mode, revision, completedTurns]);

  const changed = files.filter((file) => file.status !== "").length;
  const totals = files.reduce((sum, file) => ({ added: sum.added + (file.additions ?? 0), removed: sum.removed + (file.deletions ?? 0) }), { added: 0, removed: 0 });
  const filtered = useMemo(() => files.filter((file) => (!changesOnly || file.status !== "") && file.path.toLowerCase().includes(filter.toLowerCase())), [files, changesOnly, filter]);
  const lines = useMemo(() => preview?.text.split("\n") ?? [], [preview]);
  const openFile = (file: WorkspaceFile) => {
    setTabs((current) => current.includes(file.path) ? current : [...current, file.path]);
    setSelected(file.path);
    if (file.status.includes("D")) setMode("diff");
  };
  const closeTab = (file: string) => {
    const remaining = tabs.filter((tab) => tab !== file);
    setTabs(remaining);
    if (selected === file) setSelected(remaining.at(-1) ?? null);
  };

  return (
    <aside ref={panelRef} className={css.panel} data-placement={placement} data-testid="workspace-panel" aria-label={labels.title}
      tabIndex={-1}>
      <header className={css.header} data-window-drag>
        {cwd !== null && <span className={css.workspace} title={cwd}>{cwd.split(/[\\/]/).filter(Boolean).at(-1)}</span>}
        <button className={css.iconButton} type="button" aria-label={labels.refresh} title={labels.refresh} disabled={cwd === null || listLoading} onClick={() => setRevision((value) => value + 1)}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 6a5 5 0 1 0 .1 3M13 2.5V6H9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </header>
      {cwd === null ? <p className={css.empty}>{labels.noWorkspace}</p> : <>
        <div className={css.tabs} aria-label={labels.title}>
          {tabs.map((file) => <div className={css.tab} data-active={selected === file || undefined} key={file}>
            <button type="button" className={css.tabSelect} title={file} aria-pressed={selected === file} onClick={() => setSelected(file)}>{file.split("/").at(-1)}</button>
            <button type="button" className={css.tabClose} aria-label={`${labels.tabClose}: ${file}`} onClick={() => closeTab(file)}>x</button>
          </div>)}
          {tabs.length === 0 && <span className={css.tabPlaceholder}>{labels.readOnly}</span>}
        </div>
        <div className={css.previewToolbar}>
          <span className={css.path} title={selected ?? ""}>{selected ?? labels.select}</span>
          <div className={css.segmented}>
            <button type="button" aria-pressed={mode === "file"} onClick={() => setMode("file")}>{labels.file}</button>
            <button type="button" aria-pressed={mode === "diff"} onClick={() => setMode("diff")}>{labels.diff}</button>
          </div>
        </div>
        <div className={css.preview} aria-busy={previewLoading} tabIndex={0} role="region" aria-label={selected ?? labels.select} data-read={mode === "file" || undefined} data-diff={mode === "diff" || undefined}>
          {previewError !== null ? <p className={css.error} role="alert">{previewError}</p>
            : previewLoading ? <p className={css.empty} role="status">{labels.loading}</p>
            : preview === null ? <p className={css.empty}>{labels.select}</p>
            : mode === "diff" && preview.text === "" ? <p className={css.empty}>{labels.noDiff}</p>
            : <pre className={css.code} data-language={preview.language}>{lines.map((line, index) => <span key={index} className={css.line} data-kind={mode === "diff" ? line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "removed" : line.startsWith("@@") ? "hunk" : undefined : undefined}><span className={css.lineNumber} aria-hidden="true">{mode === "file" ? index + 1 : ""}</span><span>{line || " "}</span>{"\n"}</span>)}</pre>}
        </div>
        <section className={css.files} aria-label={labels.changed}>
          <div className={css.listToolbar}>
            <div className={css.listSwitch}>
              <button type="button" aria-pressed={!sessionView && changesOnly} onClick={() => { setSessionView(false); setChangesOnly(true); }}>{labels.changed} <span className={css.count}>{changed}</span></button>
              {changed > 0 && <span className={css.lines} data-testid="workspace-line-totals"><span data-kind="added">+{totals.added}</span>{" "}<span data-kind="removed">−{totals.removed}</span></span>}
              <button type="button" aria-pressed={!sessionView && !changesOnly} onClick={() => { setSessionView(false); setChangesOnly(false); }}>{labels.all}</button>
              <button type="button" aria-pressed={sessionView} onClick={() => setSessionView(true)}>{t("workspace.panel.sessionHistory")}</button>
            </div>
          </div>
          <input className={css.search} type="search" aria-label={labels.search} placeholder={labels.search} value={filter} onChange={(event) => setFilter(event.target.value)} />
          <div className={css.fileList} aria-busy={sessionView ? sessionLoading : listLoading}>
            {sessionView ? <>
              <p className={css.sessionNote}>{t("workspace.panel.sessionNote")}</p>
              {sessionError !== null ? <p className={css.error} role="alert">{sessionError}</p>
                : sessionLoading ? <p className={css.empty} role="status">{labels.loading}</p>
                : sessionWork.every((work) => work.commits.length === 0 && work.changes.length === 0) ? <p className={css.empty}>{labels.noChanges}</p>
                : sessionWork.map((work) => <section key={work.root} data-testid="workspace-session-worktree" className={css.sessionGroup}>
                  <h3 title={work.root} data-base={work.base || undefined}>
                    {work.branch ?? "HEAD"}
                    {work.base
                      ? <span className={css.flowBadge} data-kind="base">{t("workspace.panel.main")}</span>
                      : work.baseBranch !== null && <span className={css.flowBadge} data-testid="workspace-session-target">→ {work.baseBranch}</span>}
                    {work.current && <span className={css.flowBadge} data-kind="current">{t("workspace.panel.thisSession")}</span>}
                    <span className={css.worktreeFolder}>{work.root.split(/[\\/]/).at(-1)}</span>
                  </h3>
                  {work.changes.filter((file) => file.path.toLowerCase().includes(filter.toLowerCase())).map((file) => <div key={file.path} className={css.fileRow} title={work.root}>
                    <span className={css.filePath}>{file.path}</span><span className={css.lines}>{file.additions === null ? labels.binary : `+${file.additions ?? 0} −${file.deletions ?? 0}`}</span><span className={css.status}>{file.status}</span>
                  </div>)}
                  {work.commits.map((commit) => <details key={commit.hash} open data-testid="workspace-session-commit">
                    <summary>{commit.hash.slice(0, 7)} {commit.subject}
                      {commit.merged !== undefined && <span className={css.mergeBadge} data-testid="workspace-session-merged" data-merged={commit.merged}>
                        {commit.merged ? t("workspace.panel.merged", { branch: work.baseBranch ?? "main" }) : t("workspace.panel.notMerged")}
                      </span>}
                    </summary>
                    {commit.files.filter((file) => file.path.toLowerCase().includes(filter.toLowerCase())).map((file) => <div key={file.path} className={css.fileRow}>
                      <span className={css.filePath} title={file.path}>{file.path}</span><span className={css.lines} data-testid="workspace-session-lines">{file.additions === null ? labels.binary : `+${file.additions} −${file.deletions}`}</span>
                    </div>)}
                  </details>)}
                </section>)}
            </> : listError !== null ? <p className={css.error} role="alert">{labels.error}: {listError}</p>
              : listLoading ? <p className={css.empty} role="status">{labels.loading}</p>
              : filtered.length === 0 ? <p className={css.empty}>{changesOnly && filter === "" ? labels.noChanges : labels.empty}</p>
              : <ul>{filtered.map((file) => <li key={file.path}><button className={css.fileRow} type="button" data-active={selected === file.path || undefined} title={file.path} aria-pressed={selected === file.path} onClick={() => openFile(file)}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.5 2H4v12h8V4.5L9.5 2ZM9 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg><span className={css.filePath}>{file.path}</span>{file.additions !== undefined && (file.additions === null || file.deletions === null
                ? <span className={css.lines}>{labels.binary}</span>
                : <span className={css.lines} data-testid="workspace-file-lines"><span data-kind="added">+{file.additions}</span>{" "}<span data-kind="removed">−{file.deletions}</span></span>)}<span className={css.status} data-status={file.status.includes("D") ? "deleted" : file.status.includes("A") || file.status === "??" ? "added" : "modified"}>{file.status === "??" ? "U" : file.status}</span></button></li>)}</ul>}
          </div>
        </section>
        <footer className={css.footer}><span>{labels.readOnly}</span><span>{preview?.language ?? ""}</span></footer>
      </>}
    </aside>
  );
}
