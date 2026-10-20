// Ported from DSH ui-workspace rows/Rows.tsx (MIT, Copyright (c) 2026 DeepSeek).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useActions, useAppSelector } from "../app-context";
import type { KeyboardEvent, MouseEvent } from "react";
import clsx from "clsx";
import { AlarmClock, Archive, Check, ChevronDown, Ellipsis, FolderOpen, GitFork, Lock, Pencil, Pin, Settings2, SquareCheck, SquarePen, Trash2 } from "lucide-react";
import { SNOOZE_PRESETS, type SnoozePreset } from "../../../shared/snooze";
import { describeHolder } from "../../../shared/session-held";
import { StateDot } from "../kit";
import { ProjectBadge } from "../projects/ProjectBadge";
import { projectDisplayName } from "../projects/project-style";
import type { ThreadSummary, WorkspaceGroup } from "../../state";
import { selectMainThreadId } from "../../state";
import { useLocale, useT } from "../../i18n";
import { formatWholeSeconds, threadTitle } from "../conversation/format";
import { useElapsedMs } from "../elapsed";
import { focusRing, InputError, Menu, Tooltip } from "../kit";
import { errorText } from "../notices/error-text";
import { TESTID } from "../testids";
import { uiState, useUiState } from "../ui-state";
import { containsThread, isLiveRunning } from "./thread-filter";
import { formatRowTime, formatThreadFullTime } from "./thread-time";
import { useThreadHolders } from "./session-holders";
import { WorkspaceBadge } from "./WorkspaceBadge";

/** A sidebar row: hover and open-menu share the accent surface; the trailing action fades in over reserved padding. */
const rowClass = "group/row relative flex select-none items-center rounded-md hover:bg-sidebar-accent";

/** The row's full-width open/toggle button; its right padding keeps the title clear of the trailing action. */
const rowMainClass = clsx(
  "m-0 box-border flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch rounded-[inherit] border-0 bg-transparent py-0 pl-2 text-left text-inherit [font-family:inherit]",
  "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring",
);

/** Kept reachable for keyboard and test drivers: it is only transparent, never unmounted. */
const rowActionsClass = clsx(
  "absolute inset-y-0 right-2 inline-flex items-center opacity-0 transition-opacity duration-150 motion-reduce:transition-none",
  "group-hover/row:opacity-100 group-has-focus-visible/row:opacity-100",
);

const rowIconButtonClass = clsx(
  "m-0 box-border inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0",
  "text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-foreground motion-reduce:transition-none",
  "data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-foreground [&_svg]:size-4",
  focusRing,
);

interface WorkspaceRowProps {
  group: WorkspaceGroup;
  expanded: boolean;
  hidesActiveThread: boolean;
  onToggle(): void;
  onCreate(): void;
}

export function WorkspaceRow({ group, expanded, hidesActiveThread, onToggle, onCreate }: WorkspaceRowProps) {
  const t = useT();
  const { preferences } = useUiState();
  const label = projectDisplayName(preferences?.projectSettings, group.cwd);
  const createLabel = t("shell.sidebar.newThreadIn", { name: label });
  const toggleLabel = t(expanded ? "shell.sidebar.collapseGroup" : "shell.sidebar.expandGroup", { name: label });
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className={clsx(rowClass, "h-8", (menuOpen) && "bg-sidebar-accent", hidesActiveThread ? "text-sidebar-foreground" : "text-muted-foreground")}>
      <button type="button" className={clsx(rowMainClass, "gap-1.5 pr-16")} aria-expanded={expanded} aria-label={toggleLabel} title={group.cwd} onClick={onToggle}>
        <span className="inline-flex h-5 w-3.5 shrink-0 items-center justify-center text-muted-foreground">
          <ChevronDown aria-hidden className={clsx("size-3 transition-transform duration-150 motion-reduce:transition-none", !expanded && "-rotate-90")} />
        </span>
        <ProjectBadge cwd={group.cwd} size="sm" />
        <span className="min-w-0 truncate text-xs font-medium leading-5" data-testid={TESTID.workspaceName}>{label}</span>
        <span className="shrink-0 text-xs tabular-nums leading-5 text-muted-foreground" aria-label={t("shell.sidebar.threadCount", { count: group.threads.length })}>
          {group.threads.length}
        </span>
      </button>
      <span className={clsx(rowActionsClass, "gap-0.5", menuOpen && "opacity-100")}>
        <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Menu.Trigger className={rowIconButtonClass} data-testid={TESTID.workspaceMenu} aria-label={t("screens.projects.actions", { name: label })}>
            <Ellipsis aria-hidden />
          </Menu.Trigger>
          <Menu.Content align="end" side="bottom">
            <Menu.Item icon={<Settings2 />} data-testid={TESTID.workspaceSettings} onClick={() => uiState.openProjectSettings(group.cwd)}>{t("screens.projects.settings")}</Menu.Item>
            <Menu.Item icon={<Archive />} data-testid={TESTID.workspaceArchive} onClick={() => uiState.openArchive(group.cwd)}>{t("screens.projects.archived")}</Menu.Item>
          </Menu.Content>
        </Menu.Root>
        <Tooltip.Root>
          <Tooltip.Trigger
            render={<button type="button" className={rowIconButtonClass} data-testid={TESTID.workspaceCompose} aria-label={createLabel} onClick={onCreate} />}
          >
            <SquarePen aria-hidden />
          </Tooltip.Trigger>
          <Tooltip.Content side="bottom" align="end">{createLabel}</Tooltip.Content>
        </Tooltip.Root>
      </span>
    </div>
  );
}

interface RenameInputProps {
  initial: string;
  label: string;
  onCommit(name: string): void;
  onCancel(): void;
}

function RenameInput({ initial, label, onCommit, onCancel }: RenameInputProps) {
  const input = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  const [value, setValue] = useState(initial);

  useLayoutEffect(() => {
    const element = input.current;
    if (element === null) return;
    element.focus();
    element.setSelectionRange(0, element.value.length, "backward");
    element.scrollLeft = 0;
  }, []);

  const finish = (commit: boolean): void => {
    if (settled.current) return;
    settled.current = true;
    if (commit) onCommit(value.trim());
    else onCancel();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  };

  return (
    <input
      ref={input}
      className="mx-2 box-border h-7 min-w-0 flex-1 rounded-sm border border-solid border-input bg-background px-1.5 text-sm leading-5 text-foreground outline-none [font-family:inherit] focus-visible:border-ring"
      aria-label={label}
      value={value}
      spellCheck={false}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
    />
  );
}

interface ThreadRowProps {
  thread: ThreadSummary;
  active: boolean;
  searching?: boolean;
  nowMs: number;
  /** Shows the workspace badge; only rows mixing workspaces (pinned, settled) need it, a group header already has it. */
  showWorkspace?: boolean;
  onOpen(threadId: string): void;
  onRename(threadId: string, name: string): void;
  onRequestDelete(threadId: string, title: string): void;
  onReveal(cwd: string): void;
  /** Present (with the current settled state in `settled`) only where the sidebar offers Settle/Unsettle. */
  settled?: boolean;
  onSettle?(threadId: string, settled: boolean): void;
  /** Track A: multi-select. `picked` is this row's selection state; `selectionActive` shows the checkbox on every row. */
  picked?: boolean;
  selectionActive?: boolean;
  onPick?(threadId: string, mode: "toggle" | "range"): void;
  /** Archive through the sidebar so the Undo notice appears; without it the row archives silently. */
  onArchive?(threadId: string): void;
  onSnooze?(threadId: string, preset: SnoozePreset): void;
  /** Set on rows of the Snoozed group: when the thread wakes. */
  wakeAtMs?: number;
  onWake?(threadId: string): void;
  /** A snooze ended and the thread has not been opened since. */
  attention?: boolean;
}

/** Short wake time for the Snoozed group: weekday, day and clock time, in the user's clock format. */
function formatWakeTime(wakeAtMs: number, locale: string, timeFormat: "system" | "12h" | "24h"): string {
  return new Date(wakeAtMs).toLocaleString(locale, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    ...(timeFormat === "system" ? {} : { hour12: timeFormat === "12h" }),
  });
}

function RunningStatus({ threadId }: { threadId: string }) {
  const t = useT();
  const startedAtMs = useAppSelector(state => {
    const conversation = state.conversations[threadId];
    const turn = conversation?.turns.find(turn => turn.id === conversation.activeTurnId && turn.status === "inProgress");
    return turn?.startedAtMs ?? null;
  });
  const elapsedMs = useElapsedMs(startedAtMs);
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs tabular-nums leading-4 text-muted-foreground" data-testid="thread-running-status">
      <StateDot state="ongoing" />
      <span>{elapsedMs === null ? t("shell.sidebar.working") : t("shell.sidebar.runningElapsed", { elapsed: formatWholeSeconds(elapsedMs, t) })}</span>
    </span>
  );
}

export function ThreadRow({ thread, active, searching = false, nowMs, showWorkspace = false, onOpen, onRename, onRequestDelete, onReveal, settled = false, onSettle, picked = false, selectionActive = false, onPick, onArchive, onSnooze, wakeAtMs, onWake, attention = false }: ThreadRowProps) {
  const t = useT();
  const actions = useActions();
  const currentId = useAppSelector(selectMainThreadId);
  const threadLinks = useAppSelector(state => state.threadLinks);
  const agentChildIds = new Set(threadLinks.filter(link => link.taskId !== undefined || link.origin === "native").flatMap(link => link.childId === undefined ? [] : [link.childId]));
  const children = (thread.children ?? []).filter(child => !agentChildIds.has(child.id));
  const creator = useAppSelector(state => state.threadOrigins[thread.id] ?? "unknown");
  const creatorLabel = t(creator === "user" ? "shell.creator.user" : creator === "dori" ? "shell.creator.dori" : creator === "agent" ? "shell.creator.agent" : "shell.creator.unknown");
  const [childrenOpen, setChildrenOpen] = useState(false);
  const holdsActive = currentId !== null && (thread.children?.some(child => containsThread(child, currentId)) ?? false);
  useEffect(() => {
    if (holdsActive) setChildrenOpen(true);
  }, [holdsActive, currentId]);
  const childrenExpanded = childrenOpen || searching;
  const [linkError, setLinkError] = useState<string | null>(null);
  const childCount = children.length;
  const locale = useLocale();
  const { preferences } = useUiState();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const title = threadTitle(thread, t("shell.newSession"));
  const running = useAppSelector(state => isLiveRunning(thread, state));
  const selected = active || currentId === thread.id;
  const pinned = preferences?.pinnedThreadIds.includes(thread.id) ?? false;
  const holders = useThreadHolders(thread.id);

  const rowProps = {
    "data-testid": TESTID.threadRow,
    "data-thread-id": thread.id,
    "data-title": title,
    "aria-current": selected ? ("page" as const) : undefined,
  };

  if (renaming) {
    return (
      <div className={clsx(rowClass, "h-9 bg-sidebar-accent pl-2 text-sidebar-foreground")} {...rowProps}>
        {showWorkspace && <WorkspaceBadge cwd={thread.cwd} />}
        <RenameInput
          initial={thread.name ?? title}
          label={t("shell.sidebar.renameLabel")}
          onCommit={(name) => {
            setRenaming(false);
            if (name !== "" && name !== title) onRename(thread.id, name);
          }}
          onCancel={() => setRenaming(false)}
        />
      </div>
    );
  }

  const report = (error: unknown): void => setLinkError(errorText(error, t).text);
  const run = (work: Promise<unknown>): void => { void work.catch(report); };

  const onMainClick = (event: MouseEvent): void => {
    if (onPick !== undefined) {
      if (event.shiftKey) return onPick(thread.id, "range");
      if (event.ctrlKey || event.metaKey || selectionActive) return onPick(thread.id, "toggle");
    }
    onOpen(thread.id);
  };

  const wakeLabel = wakeAtMs === undefined ? null : t("shell.snooze.until", { time: formatWakeTime(wakeAtMs, locale, preferences?.timeFormat ?? "system") });
  const time = (
    <Tooltip.Root>
      <Tooltip.Trigger render={<span className="shrink-0 text-xs tabular-nums leading-4 text-muted-foreground" />}>
        {formatRowTime(thread.updatedAt, nowMs, t)}
      </Tooltip.Trigger>
      <Tooltip.Content side="right">{t("shell.time.updated", { time: formatThreadFullTime(thread.updatedAt, preferences?.timeFormat ?? "system", locale) })}</Tooltip.Content>
    </Tooltip.Root>
  );

  return (
    <div>
      <div
        className={clsx(
          rowClass,
          "min-h-9 text-sidebar-foreground",
          (selected || menuOpen || picked) && "bg-sidebar-accent",
          // The selected row carries the one primary mark in the list.
          selected && "before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary before:content-['']",
        )}
        {...rowProps}
        data-creator={creator}
        data-picked={picked ? "true" : undefined}
      >
        <button type="button" className={clsx(rowMainClass, "pr-9")} aria-pressed={selectionActive ? picked : undefined} onClick={onMainClick}>
          {selectionActive && (
            <span
              aria-hidden
              data-testid={TESTID.threadCheckbox}
              data-checked={picked ? "true" : "false"}
              className={clsx(
                "inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-solid",
                picked ? "border-sidebar-primary bg-sidebar-primary text-sidebar-primary-foreground" : "border-sidebar-border bg-background",
              )}
            >
              {picked && <Check className="size-3" />}
            </span>
          )}
          {attention && <span className="size-2 shrink-0 rounded-full bg-sidebar-primary" role="img" aria-label={t("shell.snooze.woken")} title={t("shell.snooze.woken")} data-testid={TESTID.threadWoken} />}
          {showWorkspace && <WorkspaceBadge cwd={thread.cwd} />}
          <span className={clsx("min-w-0 flex-1 truncate py-1 text-sm leading-5", selected ? "font-semibold" : "font-medium")} title={creator === "unknown" ? title : `${title} · ${creatorLabel}`}>
            {title}
            {wakeLabel !== null && <span className="block truncate text-xs font-normal leading-4 text-muted-foreground" data-testid={TESTID.threadWake}>{wakeLabel}</span>}
            {creator !== "unknown" && <span className="block truncate text-xs font-normal leading-4 text-muted-foreground" data-testid="thread-creator-label">{creatorLabel}</span>}
          </span>
          {holders !== undefined && (
            <Tooltip.Root>
              <Tooltip.Trigger render={<span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs leading-4 text-muted-foreground" data-testid={TESTID.threadInUse} />}>
                <Lock className="size-3" aria-hidden />
                {t("shell.sidebar.inUse")}
              </Tooltip.Trigger>
              <Tooltip.Content side="right">{t("shell.sidebar.inUseHint", { holders: holders.map(describeHolder).join("; ") })}</Tooltip.Content>
            </Tooltip.Root>
          )}
          {running ? <RunningStatus threadId={thread.id} /> : wakeLabel === null ? time : null}
        </button>
        <span className={clsx(rowActionsClass, (selected || menuOpen) && "opacity-100")}>
          <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <Menu.Trigger className={clsx(rowIconButtonClass, "w-5")} data-testid={TESTID.threadMenu} aria-label={t("shell.sidebar.sessionActions", { name: title })}>
              <Ellipsis aria-hidden />
            </Menu.Trigger>
            <Menu.Content align="end" side="bottom">
              {onPick !== undefined && !selectionActive && <Menu.Item icon={<SquareCheck />} data-testid={TESTID.threadSelect} onClick={() => onPick(thread.id, "toggle")}>{t("shell.bulk.select")}</Menu.Item>}
              <Menu.Item icon={<Pin />} onClick={() => run(actions.pinThread(thread.id, !pinned))}>{t(pinned ? "shell.sidebar.unpin" : "shell.sidebar.pin")}</Menu.Item>
              <Menu.Item icon={<Pencil />} onClick={() => setRenaming(true)}>{t("shell.sidebar.rename")}</Menu.Item>
              <Menu.Item icon={<GitFork />} onClick={() => run(actions.forkThread(thread.id))}>{t("shell.sidebar.fork")}</Menu.Item>
              <Menu.Item icon={<Archive />} onClick={() => (onArchive !== undefined ? onArchive(thread.id) : run(actions.archiveThread(thread.id)))}>{t("shell.sidebar.archive")}</Menu.Item>
              {onSettle !== undefined && <Menu.Item onClick={() => onSettle(thread.id, !settled)}>{settled ? t("shell.sidebar.unsettle") : t("shell.sidebar.settle")}</Menu.Item>}
              {onSnooze !== undefined && SNOOZE_PRESETS.map(preset => (
                <Menu.Item key={preset} icon={<AlarmClock />} data-testid={TESTID.threadSnooze} data-preset={preset} onClick={() => onSnooze(thread.id, preset)}>
                  {t("shell.snooze")}: {t(`shell.snooze.${preset}`)}
                </Menu.Item>
              ))}
              {wakeAtMs !== undefined && onWake !== undefined && <Menu.Item icon={<AlarmClock />} onClick={() => onWake(thread.id)}>{t("shell.snooze.wake")}</Menu.Item>}
              <Menu.Item icon={<FolderOpen />} onClick={() => onReveal(thread.cwd)}>{t("shell.sidebar.revealInFinder")}</Menu.Item>
              <Menu.Separator />
              <Menu.Item onClick={() => { void actions.newThread(thread.cwd, thread.id); }}>{t("shell.newRelatedSession")}</Menu.Item>
              {currentId !== null && currentId !== thread.id && <Menu.Item onClick={() => run(actions.linkThread(thread.id, currentId))}>{t("shell.linkToCurrent")}</Menu.Item>}
              {preferences?.threadParents[thread.id] !== undefined && <Menu.Item onClick={() => run(actions.linkThread(thread.id, null))}>{t("shell.unlinkSession")}</Menu.Item>}
              <Menu.Item onClick={() => run(actions.manageThread(thread.id, false))}>{t("shell.managed.remove")}</Menu.Item>
              <Menu.Separator />
              <Menu.Item onClick={() => run(actions.classifyThread(thread.id, "user"))}>{t("shell.creator.markUser")}</Menu.Item>
              <Menu.Item onClick={() => run(actions.classifyThread(thread.id, "dori"))}>{t("shell.creator.markDori")}</Menu.Item>
              <Menu.Item onClick={() => run(actions.classifyThread(thread.id, "agent"))}>{t("shell.creator.markAgent")}</Menu.Item>
              <Menu.Item onClick={() => run(actions.classifyThread(thread.id, "unknown"))}>{t("shell.creator.markUnknown")}</Menu.Item>
              <Menu.Separator />
              <Menu.Item variant="destructive" icon={<Trash2 />} onClick={() => onRequestDelete(thread.id, title)}>{t("shell.sidebar.delete")}</Menu.Item>
            </Menu.Content>
          </Menu.Root>
        </span>
      </div>
      {childCount > 0 && (
        <button
          type="button"
          className={clsx("mb-1 ml-7 mr-3 cursor-pointer rounded-sm border-0 bg-transparent px-2 py-1 text-xs text-muted-foreground [font-family:inherit] hover:text-sidebar-foreground", focusRing)}
          data-testid="thread-children-toggle"
          aria-expanded={childrenExpanded}
          onClick={() => setChildrenOpen(!childrenOpen)}
        >
          {t("shell.childWork", { count: childCount })}
        </button>
      )}
      {linkError !== null && <InputError role="alert" className="mx-2 my-1 wrap-anywhere">{linkError}</InputError>}
      {childCount > 0 && childrenExpanded && (
        <div className="ml-4 min-w-0 border-0 border-l border-solid border-sidebar-border pl-2" data-testid="thread-children">
          {children.map(child => <ThreadRow key={child.id} thread={child} active={child.id === currentId} searching={searching} nowMs={nowMs} onOpen={onOpen} onRename={onRename} onRequestDelete={onRequestDelete} onReveal={onReveal} />)}
        </div>
      )}
    </div>
  );
}
