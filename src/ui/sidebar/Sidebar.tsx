import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement, ReactNode } from "react";
import clsx from "clsx";
import { ChartNoAxesColumn, ChevronDown, CircleX, Ellipsis, FolderPlus, History, Import, MessagesSquare, PanelLeft, Search, Settings } from "lucide-react";
import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import type { StateDotState } from "@deepseek-ai/dsh-client-ui-primitives";
import type { BridgeState, BridgeStatus } from "../../../shared/ipc";
import { selectManagedThreadsByWorkspace } from "../../state";
import { selectPinnedThreads } from "../../state/selectors";
import type { ThreadSummary, WorkspaceGroup } from "../../state";
import { useT } from "../../i18n";
import { StoreContext, useActions, useAppSelector } from "../app-context";
import { APP_VERSION, isDevBuild } from "../app-version";
import { threadTitle } from "../conversation/format";
import { BrandMark } from "../glyphs";
import { focusRing, IconButton, Menu, Tooltip } from "../kit";
import { useNewSessionFlow } from "../new-session";
import { TESTID } from "../testids";
import { uiState, updatePreferences, useUiState } from "../ui-state";
import { DeleteThreadDialog } from "./DeleteThreadDialog";
import { NativeSessionsDialog } from "./NativeSessionsDialog";
import type { DeleteTarget } from "./DeleteThreadDialog";
import { ThreadRow, WorkspaceRow } from "./Rows";
import { containsThread, filterGroups, isLiveRunning } from "./thread-filter";
import type { ThreadPeriod } from "./thread-filter";
import { partitionSettled, type SettleConfig } from "./settle";

const DOT_STATE: Record<BridgeState, StateDotState> = {
  locating: "ongoing",
  starting: "ongoing",
  restarting: "ongoing",
  connected: "done",
  exited: "error",
  "not-found": "error",
  stopped: "idle",
};

const CLOCK_TICK_MS = 30_000;

const PERIODS: readonly Exclude<ThreadPeriod, "any">[] = ["today", "week", "month"];

/** Filter chip: a quiet outline that inverts when pressed (neutral, never the primary accent). */
const chipClass = clsx(
  "m-0 box-border inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border border-solid px-2.5 text-xs font-medium leading-none [font-family:inherit]",
  "border-sidebar-border bg-transparent text-muted-foreground transition-colors duration-150 motion-reduce:transition-none",
  "hover:bg-sidebar-accent hover:text-sidebar-foreground",
  "aria-pressed:border-transparent aria-pressed:bg-sidebar-foreground aria-pressed:text-sidebar",
  focusRing,
);

/** Compact square control for dense list headers, where the 36px kit IconButton would not fit. */
const compactIconClass = clsx(
  "m-0 box-border inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground",
  "transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-foreground motion-reduce:transition-none",
  "data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-foreground [&_svg]:size-4",
  focusRing,
);

function withoutPinned(threads: readonly ThreadSummary[], pinned: ReadonlySet<string>): ThreadSummary[] {
  return threads.filter(thread => !pinned.has(thread.id)).map(thread => ({ ...thread, children: withoutPinned(thread.children ?? [], pinned) }));
}

function useNowMs(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** Drops threads whose last activity moved forward out of the settled and unsettled preference lists. */
function useUnsettleOnActivity(): void {
  const store = useContext(StoreContext);
  useEffect(() => {
    if (store === null) return;
    const seen = new Map<string, number>();
    const check = (): void => {
      const preferences = uiState.get().preferences;
      const changed: string[] = [];
      for (const [id, summary] of Object.entries(store.getState().threads)) {
        const previous = seen.get(id);
        if (previous === summary.updatedAt) continue;
        seen.set(id, summary.updatedAt);
        if (previous !== undefined && summary.updatedAt > previous) changed.push(id);
      }
      if (changed.length === 0 || preferences === null) return;
      const drop = (ids: readonly string[]): string[] => ids.filter((id) => !changed.includes(id));
      const settledThreads = drop(preferences.settledThreads);
      const unsettledThreads = drop(preferences.unsettledThreads);
      if (
        settledThreads.length === preferences.settledThreads.length &&
        unsettledThreads.length === preferences.unsettledThreads.length
      ) return;
      updatePreferences({ settledThreads, unsettledThreads }).catch((error: unknown) => {
        console.warn("Could not un-settle threads after new activity", error);
      });
    };
    check();
    return store.subscribe(check);
  }, [store]);
}

/** A tooltip around a kit trigger element. */
function Tip({ label, side = "bottom", align = "center", children }: { label: string; side?: "top" | "bottom"; align?: "start" | "center" | "end"; children: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Content side={side} align={align}>{label}</Tooltip.Content>
    </Tooltip.Root>
  );
}

function ConnectionDot({ bridge }: { bridge: BridgeStatus | null }) {
  const t = useT();
  const state = bridge?.state ?? "locating";
  const stateLabel = t(`connection.${state}`);
  const version = bridge?.omo?.version;
  const label = version === undefined ? stateLabel : t("shell.connection.version", { state: stateLabel, version });
  return (
    <Tip label={label} side="top" align="end">
      <span
        className={clsx("mr-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-sm", focusRing)}
        role="img"
        tabIndex={0}
        aria-label={label}
        data-testid={TESTID.connectionDot}
        data-state={state}
      >
        <StateDot state={DOT_STATE[state]} />
      </span>
    </Tip>
  );
}

/** One quiet empty or no-match message with at most one action. */
function EmptyState({ icon, children, action, ...rest }: { icon?: ReactNode; children: ReactNode; action?: ReactNode; "data-testid"?: string; role?: string }) {
  return (
    <div {...rest} className="mb-2 mt-8 flex flex-col items-center gap-2 px-3 text-center text-sm leading-5 text-muted-foreground">
      {icon}
      <div>{children}</div>
      {action}
    </div>
  );
}

export function Sidebar() {
  const t = useT();
  const actions = useActions();
  const store = useContext(StoreContext);
  const newSession = useNewSessionFlow();
  const { preferences } = useUiState();
  const state = useAppSelector(s => s);
  const groups = useMemo(() => selectManagedThreadsByWorkspace(state, preferences?.managedThreadIds ?? []), [state.threads, state.threadOrder, state.threadLinks, preferences?.managedThreadIds]);
  const pinned = useMemo(() => selectPinnedThreads(state, preferences?.pinnedThreadIds ?? []), [state.threads, state.threadOrder, state.threadLinks, state.btw, preferences?.pinnedThreadIds]);
  const pinnedIds = new Set(pinned.map(thread => thread.id));
  const [nativeOpen, setNativeOpen] = useState(false);
  const activeThreadId = useAppSelector((state) => state.activeThreadId);
  const threadsLoaded = useAppSelector((state) => state.threadsLoaded);
  const hasMore = useAppSelector((state) => state.threadsCursor !== null);
  const bridge = useAppSelector((state) => state.bridge);
  const conversations = useAppSelector((state) => state.conversations);
  const connected = bridge?.state === "connected";
  const disconnectedHint = connected ? undefined : t("shell.newSessionDisconnected");
  const nowMs = useNowMs();
  useUnsettleOnActivity();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [settledOpen, setSettledOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [runningOnly, setRunningOnly] = useState(false);
  const [period, setPeriod] = useState<ThreadPeriod>("any");
  const [loadingMore, setLoadingMore] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const searchRef = useRef<HTMLInputElement | null>(null);

  const settleConfig = useMemo<SettleConfig>(
    () => ({
      autoSettle: preferences?.autoSettle ?? true,
      autoSettleDays: preferences?.autoSettleDays ?? 3,
      settledThreads: preferences?.settledThreads ?? [],
      unsettledThreads: preferences?.unsettledThreads ?? [],
    }),
    [preferences?.autoSettle, preferences?.autoSettleDays, preferences?.settledThreads, preferences?.unsettledThreads, preferences],
  );
  const split = useMemo(() => partitionSettled(groups.map(group => ({ ...group, threads: withoutPinned(group.threads, pinnedIds) })).filter(group => group.threads.length > 0), settleConfig, nowMs), [groups, pinned, settleConfig, nowMs]);
  const settledRef = useRef(split.settled);
  settledRef.current = split.settled;
  const settledGroup = useMemo<WorkspaceGroup>(() => ({ cwd: "settled", label: "", threads: split.settled }), [split]);

  const fallbackTitle = t("shell.newSession");
  const runningOf = useMemo(() => (thread: ThreadSummary) => isLiveRunning(thread, { bridge, conversations }), [bridge, conversations]);
  const visiblePinned = filterGroups([{ cwd: "pinned", label: "", threads: pinned.map(thread => ({ ...thread, children: withoutPinned(thread.children ?? [], pinnedIds) })) }],
    { query, runningOnly, period }, nowMs, thread => threadTitle(thread, fallbackTitle), runningOf)[0]?.threads ?? [];
  const visibleGroups = useMemo(
    () => filterGroups(split.groups, { query, runningOnly, period }, nowMs, (thread: ThreadSummary) => threadTitle(thread, fallbackTitle), runningOf),
    [split, query, runningOnly, period, nowMs, fallbackTitle, runningOf],
  );
  const visibleSettled = useMemo(
    () => filterGroups([settledGroup], { query, runningOnly, period }, nowMs, (thread: ThreadSummary) => threadTitle(thread, fallbackTitle), runningOf)[0]?.threads ?? [],
    [settledGroup, query, runningOnly, period, nowMs, fallbackTitle, runningOf],
  );
  const runningCount = useMemo(() => pinned.filter(runningOf).length + split.groups.reduce((count, group) => count + group.threads.filter(runningOf).length, 0), [split, pinned, runningOf]);
  const searching = query.trim() !== "";
  const filtering = runningOnly || period !== "any";
  const settledExpanded = settledOpen || searching;
  const empty = threadsLoaded && groups.length === 0 && pinned.length === 0;

  const expand = (cwd: string): void => {
    setCollapsed((current) => {
      if (!current.has(cwd)) return current;
      const next = new Set(current);
      next.delete(cwd);
      return next;
    });
  };

  const toggle = (cwd: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(cwd)) next.add(cwd);
      return next;
    });
  };

  useEffect(() => {
    if (activeThreadId === null) return;
    const owner = groupsRef.current.find((group) => group.threads.some((thread) => containsThread(thread, activeThreadId)));
    if (owner !== undefined) expand(owner.cwd);
    if (settledRef.current.some((thread) => containsThread(thread, activeThreadId))) setSettledOpen(true);
  }, [activeThreadId, groups, split.settled]);

  const pushError = (error: unknown): void => {
    store?.dispatch({
      type: "notice/pushed",
      notice: { id: crypto.randomUUID(), level: "error", message: error instanceof Error ? error.message : String(error), threadId: null },
    });
  };

  const setSettled = (threadId: string, settled: boolean): void => {
    const preferences = uiState.get().preferences;
    if (preferences === null) return;
    const settledThreads = settled
      ? [...preferences.settledThreads.filter((id) => id !== threadId), threadId]
      : preferences.settledThreads.filter((id) => id !== threadId);
    const unsettledThreads = settled
      ? preferences.unsettledThreads.filter((id) => id !== threadId)
      : [...preferences.unsettledThreads.filter((id) => id !== threadId), threadId];
    updatePreferences({ settledThreads, unsettledThreads }).catch(pushError);
  };

  const loadMore = async (): Promise<void> => {
    setLoadingMore(true);
    await actions.refreshThreads(true);
    setLoadingMore(false);
  };

  const reveal = (cwd: string): void => {
    window.omo.revealPath(cwd).catch(pushError);
  };

  const clearSearch = (): void => {
    setQuery("");
    searchRef.current?.focus();
  };

  const clearFilters = (): void => {
    setRunningOnly(false);
    setPeriod("any");
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape" && query !== "" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      clearSearch();
    }
  };

  const rowHandlers = {
    onOpen: (threadId: string) => void actions.openThread(threadId),
    onRename: (threadId: string, name: string) => void actions.renameThread(threadId, name),
    onRequestDelete: (threadId: string, title: string) => setDeleteTarget({ threadId, title }),
    onReveal: reveal,
  };

  return (
    <nav
      className="box-border flex h-full flex-col bg-sidebar px-2.5 pb-1.5 text-sm text-sidebar-foreground [word-break:keep-all] wrap-break-word in-data-[platform=darwin]:bg-sidebar/55"
      data-testid={TESTID.sidebar}
      aria-label={t("shell.sessions")}
    >
      <div className="-mx-2.5 box-border flex h-13 shrink-0 items-center gap-2 pl-3.5 pr-2 in-data-[platform=darwin]:pl-21" data-window-drag>
        <span className="inline-flex min-w-0 flex-1 select-none items-center gap-2">
          <BrandMark size={22} className="shrink-0 rounded-md" />
          <span className="min-w-0 overflow-hidden whitespace-nowrap font-[family-name:var(--dsw-font-family-brand)] text-base font-semibold leading-5 tracking-[0.01em] text-sidebar-foreground">{t("app.brand")}</span>
          {isDevBuild() && (
            <span className="shrink-0 rounded-sm border border-solid border-sidebar-border px-1 font-mono text-[10px] font-semibold leading-4 tracking-wider text-muted-foreground" title={APP_VERSION}>
              {t("shell.devBadge")}
            </span>
          )}
        </span>
        <Tip label={t("shell.hideSidebar")} align="end">
          <IconButton icon={<PanelLeft />} label={t("shell.hideSidebar")} data-testid={TESTID.sidebarToggle} onClick={() => uiState.toggleSidebar()} />
        </Tip>
      </div>
      <div className="relative mx-0.5 mb-2.5 mt-1 box-border flex h-9 shrink-0 items-center gap-2 rounded-md border border-solid border-sidebar-border bg-background px-2.5 text-muted-foreground focus-within:border-ring" role="search">
        <Search aria-hidden className="size-4 shrink-0" />
        <input
          ref={searchRef}
          type="text"
          className="m-0 h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm leading-5 text-foreground outline-none [font-family:inherit] placeholder:text-muted-foreground"
          data-testid={TESTID.sidebarSearch}
          data-modal-autofocus=""
          aria-label={t("shell.search.label")}
          placeholder={t("shell.search.placeholder")}
          value={query}
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
        />
        {query !== "" && (
          <button
            type="button"
            className={clsx("-mr-1 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground", focusRing)}
            data-testid={TESTID.sidebarSearchClear}
            aria-label={t("shell.search.clear")}
            onClick={clearSearch}
          >
            <CircleX aria-hidden className="size-4" />
          </button>
        )}
      </div>
      <div className="mx-0.5 mb-2.5 flex shrink-0 flex-wrap gap-1.5" role="group" aria-label={t("shell.filter.label")} data-testid={TESTID.sidebarFilters}>
        <button
          type="button"
          className={chipClass}
          aria-pressed={runningOnly}
          title={t("shell.filter.runningHint")}
          data-testid={TESTID.sidebarFilterRunning}
          onClick={() => setRunningOnly((on) => !on)}
        >
          {t("shell.filter.running")}
          {runningCount > 0 && <span className="tabular-nums opacity-70">{runningCount}</span>}
        </button>
        {PERIODS.map((option) => (
          <button
            type="button"
            key={option}
            className={chipClass}
            aria-pressed={period === option}
            title={t(`shell.filter.${option}Hint`)}
            data-testid={TESTID.sidebarFilterPeriod}
            data-period={option}
            onClick={() => setPeriod((current) => (current === option ? "any" : option))}
          >
            {t(`shell.filter.${option}`)}
          </button>
        ))}
      </div>
      <div className="-mr-2.5 flex min-h-0 flex-1 flex-col">
        <div className="mr-0.5 flex min-h-0 flex-1 flex-col overflow-y-auto pb-4 pr-1.5 [scrollbar-gutter:stable]">
          {visiblePinned.length > 0 && (
            <section className="flex flex-col gap-0.5" data-testid={TESTID.sidebarPinned} aria-label={t("shell.sidebar.pinned")}>
              <h2 className="m-0 px-2.5 py-2 text-xs font-semibold text-muted-foreground">{t("shell.sidebar.pinned")}</h2>
              {visiblePinned.map(thread => (
                <ThreadRow key={thread.id} thread={thread} active={thread.id === activeThreadId} nowMs={nowMs} searching={searching} showWorkspace {...rowHandlers} />
              ))}
            </section>
          )}
          <div className="flex items-center gap-2 py-1 pl-2.5 pr-2">
            <h2 className="m-0 min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground" data-testid="sidebar-managed-sessions">{t("shell.managed.section")}</h2>
            <Menu.Root>
              <Menu.Trigger className={compactIconClass} data-testid="sidebar-managed-menu" aria-label={t("shell.managed.actions")}>
                <Ellipsis aria-hidden />
              </Menu.Trigger>
              <Menu.Content align="end" side="bottom">
                <Menu.Item icon={<History />} data-testid="native-sessions-open" onClick={() => setNativeOpen(true)}>{t("shell.managed.inventory")}</Menu.Item>
                <Menu.Item icon={<Import />} onClick={() => uiState.setSessionImportOpen(true)}>{t("shell.import.open")}</Menu.Item>
              </Menu.Content>
            </Menu.Root>
          </div>
          {empty && <EmptyState icon={<MessagesSquare aria-hidden className="size-6" />}>{t("shell.empty.message")}</EmptyState>}
          {(searching || filtering) && !empty && visiblePinned.length === 0 && visibleGroups.length === 0 && visibleSettled.length === 0 && (
            <EmptyState
              data-testid={TESTID.sidebarNoMatch}
              role="status"
              action={filtering ? <button type="button" className={chipClass} data-testid={TESTID.sidebarFilterClear} onClick={clearFilters}>{t("shell.filter.clear")}</button> : undefined}
            >
              {searching ? t("shell.search.noMatch", { query: query.trim() }) : t("shell.filter.noMatch")}
            </EmptyState>
          )}
          <div className="flex flex-col gap-2">
            {visibleGroups.map((group) => {
              const expanded = searching || filtering || !collapsed.has(group.cwd);
              const holdsActive = activeThreadId !== null && group.threads.some((thread) => containsThread(thread, activeThreadId));
              return (
                <div key={group.cwd} className="flex flex-col gap-0.5" role="group" data-testid={TESTID.workspaceGroup} data-cwd={group.cwd} aria-label={group.label}>
                  <WorkspaceRow
                    group={group}
                    expanded={expanded}
                    hidesActiveThread={!expanded && holdsActive}
                    onToggle={() => toggle(group.cwd)}
                    onCreate={() => {
                      expand(group.cwd);
                      void actions.newThread(group.cwd);
                    }}
                  />
                  {expanded && group.threads.map((thread) => (
                    <ThreadRow key={thread.id} thread={thread} active={thread.id === activeThreadId} searching={searching} nowMs={nowMs} onSettle={setSettled} {...rowHandlers} />
                  ))}
                </div>
              );
            })}
          </div>
          {hasMore && !searching && (
            <button type="button" className={clsx("mt-1 h-7 shrink-0 cursor-pointer rounded-sm border-0 bg-transparent pl-7 pr-3 text-left text-xs text-muted-foreground [font-family:inherit] hover:enabled:text-sidebar-foreground disabled:cursor-default", focusRing)} disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? t("shell.sidebar.loadingMore") : t("shell.sidebar.loadMore")}
            </button>
          )}
          <button
            type="button"
            className={clsx(
              "mx-0.5 mt-3.5 box-border flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-sidebar-border bg-transparent px-3",
              "text-sm font-medium leading-5 text-muted-foreground [font-family:inherit] transition-colors duration-150 motion-reduce:transition-none",
              "hover:enabled:bg-sidebar-accent hover:enabled:text-sidebar-foreground disabled:cursor-default disabled:opacity-50",
              focusRing,
            )}
            data-testid={TESTID.newSession}
            disabled={!connected}
            title={disconnectedHint}
            onClick={() => void newSession()}
          >
            <FolderPlus aria-hidden className="size-4 shrink-0" />
            <span className="truncate">{t("shell.newProject")}</span>
          </button>
          {!empty && (
            <div className="mx-0.5 mt-3.5 flex shrink-0 flex-col gap-0.5" data-testid={TESTID.sidebarSettled}>
              <div className="mx-2.5 mb-1.5 h-px bg-sidebar-border" role="separator" />
              <button
                type="button"
                className={clsx("flex h-7 cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent px-2 text-left text-xs leading-4 text-muted-foreground [font-family:inherit] hover:bg-sidebar-accent hover:text-sidebar-foreground", focusRing)}
                data-testid={TESTID.sidebarSettledToggle}
                aria-expanded={settledExpanded}
                aria-label={t(settledExpanded ? "shell.sidebar.collapseSettled" : "shell.sidebar.expandSettled")}
                onClick={() => setSettledOpen((open) => !open)}
              >
                <ChevronDown aria-hidden className={clsx("size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none", !settledExpanded && "-rotate-90")} />
                <span className="min-w-0 flex-1 truncate">{t("shell.sidebar.settled")}</span>
                <span className="shrink-0 tabular-nums" aria-label={t("shell.sidebar.settledThreads", { count: visibleSettled.length })}>
                  {visibleSettled.length}
                </span>
              </button>
              {settledExpanded && visibleSettled.map((thread) => (
                <ThreadRow key={thread.id} thread={thread} active={thread.id === activeThreadId} searching={searching} nowMs={nowMs} settled showWorkspace onSettle={setSettled} {...rowHandlers} />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="-mx-0.5 mt-1 flex shrink-0 items-center gap-1">
        <button
          type="button"
          className={clsx("box-border flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent pl-2 pr-2.5 text-sm leading-5 text-sidebar-foreground [font-family:inherit] hover:bg-sidebar-accent", focusRing)}
          data-testid={TESTID.openSettings}
          aria-haspopup="dialog"
          onClick={() => uiState.setSettingsOpen(true)}
        >
          <Settings aria-hidden className="size-4 shrink-0" />
          <span className="truncate">{t("shell.openSettings")}</span>
        </button>
        <Tip label={t("shell.openAccounts")} side="top" align="end">
          <IconButton icon={<ChartNoAxesColumn />} label={t("shell.openAccounts")} data-testid={TESTID.openAccounts} onClick={() => uiState.setSettingsOpen(true, "accounts")} />
        </Tip>
        <ConnectionDot bridge={bridge} />
      </div>
      {nativeOpen && <NativeSessionsDialog onClose={() => setNativeOpen(false)} />}
      <DeleteThreadDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </nav>
  );
}
