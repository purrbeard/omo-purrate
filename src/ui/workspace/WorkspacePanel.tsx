import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionWorktree, WorkspaceFile } from "../../../shared/workspace";
import { useT } from "../../i18n";
import { useAppSelector } from "../app-context";
import { GIT_REFRESH_EVENT, selectCompletedTurnCount } from "../git/use-git-info";
import { uiState } from "../ui-state";
import clsx from "clsx";
import { Input } from "../kit";

// Keyboard focus inside the panel draws an inset ring on buttons and the preview region.
const FOCUS = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid";
const PANEL = clsx(
  "flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-solid border-border bg-background text-xs leading-[1.5] text-foreground",
  "data-[placement=overlay]:shadow-[var(--dsw-elevation-soft),0_18px_48px_-12px_color-mix(in_srgb,var(--foreground)_28%,transparent)]",
  "[&_button:focus-visible]:outline-2 [&_button:focus-visible]:-outline-offset-2 [&_button:focus-visible]:outline-ring [&_button:focus-visible]:outline-solid",
);
/** Header, preview toolbar, list toolbar and footer rows. */
const BAR = "flex flex-none items-center gap-2";
// Code, line counts and status letters keep the system monospace stack the panel shipped with.
const MONO = "[font-family:ui-monospace,SFMono-Regular,Consolas,monospace]";
const TAB_BUTTON = "cursor-pointer border-0 bg-transparent px-0 py-1 text-muted-foreground [font:inherit]";
const SEGMENT = "cursor-pointer rounded-xs border-0 bg-transparent px-[7px] py-0.5 text-[11px] text-muted-foreground [font-family:inherit] aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-[0_1px_3px_color-mix(in_srgb,var(--foreground)_10%,transparent)]";
const LIST_SWITCH = "flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-xs leading-[1.5] text-muted-foreground [font-family:inherit] aria-pressed:font-semibold aria-pressed:text-foreground";
const LINES = clsx("inline-flex flex-none gap-1 text-[10px] leading-4 font-medium text-muted-foreground [&_[data-kind=added]]:text-success [&_[data-kind=removed]]:text-destructive-foreground", MONO);
const STATUS = clsx("flex-none text-[10px] leading-4 font-semibold text-ring data-[status=added]:text-success data-[status=deleted]:text-destructive-foreground", MONO);
const FILE_ROW = "box-border flex w-full min-w-0 items-center gap-2 rounded-[5px] border-0 bg-transparent px-2 py-1.5 text-left text-[11px] text-muted-foreground [font-family:inherit]";
const FILE_PATH = "min-w-0 flex-1 truncate";
const EMPTY = "m-0 px-3.5 py-5 text-muted-foreground [overflow-wrap:anywhere]";
const ERROR = "m-0 px-3.5 py-5 text-foreground [overflow-wrap:anywhere]";
const BADGE = "ml-1.5 inline-block rounded-full border border-solid border-border px-1.5 align-middle text-[11px] leading-[17px] font-medium text-muted-foreground [corner-shape:round]!";

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
  const [changesOnly, setChangesOnly] = useState(() => uiState.get().filesView === "changes");
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
    <aside ref={panelRef} className={PANEL} data-placement={placement} data-testid="workspace-panel" aria-label={labels.title}
      tabIndex={-1}>
      <header className={clsx(BAR, "h-[46px] border-b border-border pr-2.5 pl-3.5")} data-window-drag>
        {cwd !== null && <span className="min-w-0 flex-1 truncate text-muted-foreground" title={cwd}>{cwd.split(/[\\/]/).filter(Boolean).at(-1)}</span>}
        <button className="grid size-7 flex-none cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:not-disabled:bg-sidebar-accent disabled:cursor-default disabled:opacity-40" type="button" aria-label={labels.refresh} title={labels.refresh} disabled={cwd === null || listLoading} onClick={() => setRevision((value) => value + 1)}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 6a5 5 0 1 0 .1 3M13 2.5V6H9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </header>
      {cwd === null ? <p className={EMPTY}>{labels.noWorkspace}</p> : <>
        {tabs.length > 0 && <div className="flex min-h-[34px] flex-none overflow-x-auto border-b border-border" aria-label={labels.title}>
          {tabs.map((file) => <div className="flex max-w-[190px] flex-none items-center border-r border-b-2 border-r-border border-b-transparent pr-[5px] pl-2.5 data-active:border-b-ring data-active:bg-foreground/4" data-active={selected === file || undefined} key={file}>
            <button type="button" className={clsx(TAB_BUTTON, "min-w-0 truncate")} title={file} aria-pressed={selected === file} onClick={() => setSelected(file)}>{file.split("/").at(-1)}</button>
            <button type="button" className={clsx(TAB_BUTTON, "ml-1.5 w-5 rounded-xs hover:bg-sidebar-accent")} aria-label={`${labels.tabClose}: ${file}`} onClick={() => closeTab(file)}>x</button>
          </div>)}
        </div>}
        <div className={clsx(BAR, "h-9 border-b border-border pr-2.5 pl-3.5")}>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={selected ?? ""}>{selected ?? ""}</span>
          <div className="flex flex-none rounded-md bg-foreground/5 p-0.5">
            <button type="button" className={SEGMENT} aria-pressed={mode === "file"} onClick={() => setMode("file")}>{labels.file}</button>
            <button type="button" className={SEGMENT} aria-pressed={mode === "diff"} onClick={() => setMode("diff")}>{labels.diff}</button>
          </div>
        </div>
        <div className={clsx("min-h-[90px] flex-[1_1_50%] overflow-auto", FOCUS)} aria-busy={previewLoading} tabIndex={0} role="region" aria-label={selected ?? labels.select} data-read={mode === "file" || undefined} data-diff={mode === "diff" || undefined}>
          {previewError !== null ? <p className={ERROR} role="alert">{previewError}</p>
            : previewLoading ? <p className={EMPTY} role="status">{labels.loading}</p>
            : preview === null ? <p className={EMPTY}>{labels.select}</p>
            : mode === "diff" && preview.text === "" ? <p className={EMPTY}>{labels.noDiff}</p>
            : <pre className={clsx("m-0 min-w-max px-0 py-3 text-[11px] leading-[19px] [tab-size:2]", MONO)} data-language={preview.language}>{lines.map((line, index) => <span key={index} className="block min-h-[19px] pr-4 whitespace-pre data-[kind=added]:bg-success/12 data-[kind=added]:text-success data-[kind=hunk]:bg-ring/7 data-[kind=hunk]:text-ring data-[kind=removed]:bg-destructive-foreground/12 data-[kind=removed]:text-destructive-foreground" data-kind={mode === "diff" ? line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "removed" : line.startsWith("@@") ? "hunk" : undefined : undefined}><span className="box-border inline-block w-11 pr-3 text-right text-muted-foreground select-none" aria-hidden="true">{mode === "file" ? index + 1 : ""}</span><span>{line || " "}</span>{"\n"}</span>)}</pre>}
        </div>
        <section className="flex min-h-[140px] flex-[0_1_34%] flex-col overflow-hidden border-t border-border" aria-label={labels.changed}>
          <div className={clsx(BAR, "h-[38px] px-3")}>
            <div className="flex items-center gap-3">
              <button type="button" className={LIST_SWITCH} aria-pressed={!sessionView && changesOnly} onClick={() => { setSessionView(false); setChangesOnly(true); }}>{labels.changed} <span className="rounded-[5px] bg-foreground/7 px-[5px] text-[10px] font-normal text-muted-foreground">{changed}</span></button>
              {changed > 0 && <span className={LINES} data-testid="workspace-line-totals"><span data-kind="added">+{totals.added}</span>{" "}<span data-kind="removed">−{totals.removed}</span></span>}
              <button type="button" className={LIST_SWITCH} aria-pressed={!sessionView && !changesOnly} onClick={() => { setSessionView(false); setChangesOnly(false); }}>{labels.all}</button>
              <button type="button" className={LIST_SWITCH} aria-pressed={sessionView} onClick={() => setSessionView(true)}>{t("workspace.panel.sessionHistory")}</button>
            </div>
          </div>
          <Input className="mx-3 mb-2 h-auto! w-[calc(100%-24px)]! flex-none rounded-md! border-border! bg-transparent! px-[9px]! py-[5px]! text-xs! leading-[1.5]!" type="search" aria-label={labels.search} placeholder={labels.search} value={filter} onChange={(event) => setFilter(event.target.value)} />
          <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-1.5" aria-busy={sessionView ? sessionLoading : listLoading}>
            {sessionView ? <>
              <p className="mx-2 my-1.5 text-[11px] text-muted-foreground">{t("workspace.panel.sessionNote")}</p>
              {sessionError !== null ? <p className={ERROR} role="alert">{sessionError}</p>
                : sessionLoading ? <p className={EMPTY} role="status">{labels.loading}</p>
                : sessionWork.every((work) => work.commits.length === 0 && work.changes.length === 0) ? <p className={EMPTY}>{labels.noChanges}</p>
                : sessionWork.map((work) => <section key={work.root} data-testid="workspace-session-worktree" className="border-b border-border px-2 py-1.5">
                  <h3 className="mx-0 my-1 text-xs leading-[1.5] font-semibold [font-family:inherit] [overflow-wrap:anywhere]" title={work.root} data-base={work.base || undefined}>
                    {work.branch ?? "HEAD"}
                    {work.base
                      ? <span className={clsx(BADGE, "border-success/45 text-success")} data-kind="base">{t("workspace.panel.main")}</span>
                      : work.baseBranch !== null && <span className={BADGE} data-testid="workspace-session-target">→ {work.baseBranch}</span>}
                    {work.current && <span className={clsx(BADGE, "border-foreground text-foreground")} data-kind="current">{t("workspace.panel.thisSession")}</span>}
                    <span className="ml-1.5 font-normal text-muted-foreground">{work.root.split(/[\\/]/).at(-1)}</span>
                  </h3>
                  {work.changes.filter((file) => file.path.toLowerCase().includes(filter.toLowerCase())).map((file) => <div key={file.path} className={clsx(FILE_ROW, "cursor-default")} title={work.root}>
                    <span className={FILE_PATH}>{file.path}</span><span className={LINES}>{file.additions === null ? labels.binary : `+${file.additions ?? 0} −${file.deletions ?? 0}`}</span><span className={STATUS}>{file.status}</span>
                  </div>)}
                  {work.commits.map((commit) => <details key={commit.hash} open data-testid="workspace-session-commit">
                    <summary className="cursor-pointer [overflow-wrap:anywhere]">{commit.hash.slice(0, 7)} {commit.subject}
                      {commit.merged !== undefined && <span className={clsx(BADGE, "data-[merged=false]:border-warning/50 data-[merged=false]:text-warning data-[merged=true]:border-success/45 data-[merged=true]:text-success")} data-testid="workspace-session-merged" data-merged={commit.merged}>
                        {commit.merged ? t("workspace.panel.merged", { branch: work.baseBranch ?? "main" }) : t("workspace.panel.notMerged")}
                      </span>}
                    </summary>
                    {commit.files.filter((file) => file.path.toLowerCase().includes(filter.toLowerCase())).map((file) => <div key={file.path} className={clsx(FILE_ROW, "cursor-default")}>
                      <span className={FILE_PATH} title={file.path}>{file.path}</span><span className={LINES} data-testid="workspace-session-lines">{file.additions === null ? labels.binary : `+${file.additions} −${file.deletions}`}</span>
                    </div>)}
                  </details>)}
                </section>)}
            </> : listError !== null ? <p className={ERROR} role="alert">{labels.error}: {listError}</p>
              : listLoading ? <p className={EMPTY} role="status">{labels.loading}</p>
              : filtered.length === 0 ? <p className={EMPTY}>{changesOnly && filter === "" ? labels.noChanges : labels.empty}</p>
              : <ul className="m-0 list-none p-0">{filtered.map((file) => <li key={file.path}><button className={clsx(FILE_ROW, "cursor-pointer hover:bg-sidebar-accent data-active:bg-ring/10 data-active:text-foreground")} type="button" data-active={selected === file.path || undefined} title={file.path} aria-pressed={selected === file.path} onClick={() => openFile(file)}><svg className="flex-none text-muted-foreground" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.5 2H4v12h8V4.5L9.5 2ZM9 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg><span className={FILE_PATH}>{file.path}</span>{file.additions !== undefined && (file.additions === null || file.deletions === null
                ? <span className={LINES}>{labels.binary}</span>
                : <span className={LINES} data-testid="workspace-file-lines"><span data-kind="added">+{file.additions}</span>{" "}<span data-kind="removed">−{file.deletions}</span></span>)}<span className={STATUS} data-status={file.status.includes("D") ? "deleted" : file.status.includes("A") || file.status === "??" ? "added" : "modified"}>{file.status === "??" ? "U" : file.status}</span></button></li>)}</ul>}
          </div>
        </section>
        <footer className={clsx(BAR, "h-[25px] justify-between border-t border-border px-3 text-[10px] text-muted-foreground")}><span>{labels.readOnly}</span><span>{preview?.language ?? ""}</span></footer>
      </>}
    </aside>
  );
}
