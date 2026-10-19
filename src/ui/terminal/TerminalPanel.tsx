import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronLeft, ChevronRight, Columns2, PanelBottom, PanelRight, Plus, Rows2, SquareTerminal, Trash2 } from "lucide-react";
import { Button, focusRing, Tooltip } from "../kit";
import { useT } from "../../i18n";
import { selectMainThreadId } from "../../state";
import { useAppSelector } from "../app-context";
import { moveTerminal, terminalIds, terminalLayout, terminalNumber, terminalsOf, useTerminalLayout } from "./terminal-layout";
import type { TerminalGroup } from "./terminal-layout";
import { TerminalPane } from "./TerminalPane";
import type { PaneStatus } from "./TerminalPane";
import { useDrag } from "./use-drag";

/** Where the panel is mounted: the bottom drawer, or the side panel docked or floating over a narrow window. */
export type TerminalPanelPlacement = "bottom" | "docked" | "overlay";

/** Smallest pane along the split axis while dragging a divider, in px. */
const PANE_MIN = 72;

const toolButton = clsx(
  "m-0 box-border inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground",
  "transition-colors duration-150 motion-reduce:transition-none hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
  "[&_svg]:size-4 [&_svg]:shrink-0",
  focusRing,
);

function ToolButton({ icon, label, testId, onClick, disabled, extra }: { icon: ReactElement; label: string; testId: string; onClick(): void; disabled?: boolean; extra?: Record<`data-${string}`, string> }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={<button type="button" className={toolButton} aria-label={label} data-testid={testId} disabled={disabled} onClick={onClick} {...extra} />}>{icon}</Tooltip.Trigger>
      <Tooltip.Content side="bottom">{label}</Tooltip.Content>
    </Tooltip.Root>
  );
}

/** Divider between two panes of a split group; dragging moves the boundary and keeps both panes above PANE_MIN. */
function PaneDivider({ horizontal, label, onStart, onDrag }: { horizontal: boolean; label: string; onStart(): void; onDrag(delta: number): void }) {
  const { dragging, handlers } = useDrag(horizontal ? "x" : "y", { onStart, onDrag });
  return (
    <div role="separator" aria-orientation={horizontal ? "vertical" : "horizontal"} aria-label={label} data-testid="terminal-split-divider" data-dragging={dragging || undefined} {...handlers}
      className={clsx("relative z-10 shrink-0 touch-none after:absolute after:bg-border after:content-[''] hover:after:bg-ring data-dragging:after:bg-ring",
        horizontal ? "-mx-1 w-2 cursor-col-resize after:inset-y-1 after:left-[3px] after:w-px" : "-my-1 h-2 cursor-row-resize after:inset-x-1 after:top-[3px] after:h-px")} />
  );
}

function PaneGroup({ group, threadId, renderPane }: { group: TerminalGroup; threadId: string; renderPane(id: string): ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const horizontal = group.splitDirection === "horizontal";
  const base = useRef<{ sizes: number[]; unit: number }>({ sizes: [], unit: 1 });
  const start = (): void => {
    const box = ref.current?.getBoundingClientRect();
    const extent = box === undefined ? 0 : horizontal ? box.width : box.height;
    const total = group.sizes.reduce((sum, size) => sum + size, 0);
    base.current = { sizes: [...group.sizes], unit: extent > 0 ? extent / total : 1 };
  };
  const drag = (index: number, delta: number): void => {
    const { sizes, unit } = base.current;
    const pair = (sizes[index] ?? 0) + (sizes[index + 1] ?? 0);
    const min = Math.min(PANE_MIN / unit, pair / 2);
    const first = Math.min(pair - min, Math.max(min, (sizes[index] ?? 0) + delta / unit));
    terminalLayout.setSizes(threadId, group.id, sizes.map((size, at) => at === index ? first : at === index + 1 ? pair - first : size));
  };
  return (
    <div ref={ref} className={clsx("flex min-h-0 min-w-0 flex-1", horizontal ? "flex-row" : "flex-col")} data-testid="terminal-panes" data-split={group.splitDirection} data-group-id={group.id}>
      {group.terminalIds.map((id, index) => (
        <Fragment key={id}>
          {index > 0 && <PaneDivider horizontal={horizontal} label={t("terminal.resizePanes")} onStart={start} onDrag={delta => drag(index - 1, delta)} />}
          <div className="flex min-h-0 min-w-0" style={{ flex: `${group.sizes[index] ?? 1} 1 0px` }}>{renderPane(id)}</div>
        </Fragment>
      ))}
    </div>
  );
}

/** One thread's panel; keyed by thread, so pane statuses and restart counters start over on a thread switch. */
function ThreadTerminals({ threadId, cwd, placement }: { threadId: string | null; cwd: string | undefined; placement: TerminalPanelPlacement }) {
  const t = useT();
  const headingId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  useTerminalLayout();
  const layout = terminalsOf(threadId);
  const ids = terminalIds(layout);
  const active = layout.activeTerminalId;
  const group = layout.groups.find(entry => entry.id === layout.activeGroupId) ?? layout.groups[0]!;
  const [statuses, setStatuses] = useState<Readonly<Record<string, PaneStatus>>>({});
  const [revisions, setRevisions] = useState<Readonly<Record<string, number>>>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const reporters = useRef(new Map<string, (error: unknown) => void>());
  const ready = threadId !== null && cwd !== undefined;
  const status = statuses[active];
  const running = ready && status?.running === true;
  const opening = ready && (busy.has(active) || status?.opening !== false);
  const listShown = ready && (layout.listOpen ?? ids.length > 1);
  const bottom = placement === "bottom";
  // Without a shell to focus, the panel itself takes focus when it opens or moves (a floating dock traps Tab inside it).
  useEffect(() => { if (!ready) panelRef.current?.focus(); }, [placement, ready]);

  const report = useCallback((id: string, error: unknown): void => { reporters.current.get(id)?.(error); }, []);
  const withBusy = (id: string, on: boolean): void => setBusy(current => {
    const next = new Set(current);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  const restart = async (): Promise<void> => {
    if (!ready || opening) return;
    const id = active;
    withBusy(id, true);
    try {
      await window.omo.terminalKill(threadId, id);
      setRevisions(current => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
    } catch (error) {
      report(id, error);
    } finally { withBusy(id, false); }
  };
  const close = async (): Promise<void> => {
    if (!ready) return;
    const id = active;
    withBusy(id, true);
    try {
      await window.omo.terminalKill(threadId, id);
      terminalLayout.close(threadId, id);
    } catch (error) {
      report(id, error);
    } finally { withBusy(id, false); }
  };

  const toolbar = ready && (
    <div className="flex shrink-0 items-center gap-0.5" role="toolbar" aria-label={t("terminal.list.label")}>
      <ToolButton icon={listShown ? <ChevronRight /> : <ChevronLeft />} label={t(listShown ? "terminal.list.hide" : "terminal.list.show")} testId="terminal-list-toggle" onClick={() => terminalLayout.setListOpen(threadId, !listShown)} />
      <ToolButton icon={<Columns2 />} label={t("terminal.splitHorizontal")} testId="terminal-split-horizontal" onClick={() => terminalLayout.split(threadId, "horizontal")} />
      <ToolButton icon={<Rows2 />} label={t("terminal.splitVertical")} testId="terminal-split-vertical" onClick={() => terminalLayout.split(threadId, "vertical")} />
      <ToolButton icon={<Plus />} label={t("terminal.new")} testId="terminal-new" onClick={() => terminalLayout.newTerminal(threadId)} />
      <ToolButton icon={<Trash2 />} label={t("terminal.close")} testId="terminal-close" disabled={busy.has(active)} onClick={() => void close()} />
    </div>
  );
  const name = (id: string): string => t("terminal.name", { n: terminalNumber(id) });
  const row = (id: string, nested: boolean): ReactNode => (
    <li key={id} className="flex">
      <button type="button" data-testid="terminal-row" data-terminal-id={id} aria-current={id === active ? "true" : undefined} onClick={() => terminalLayout.activate(threadId!, id)}
        className={clsx("m-0 box-border flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent pr-2 text-left text-xs text-muted-foreground [font-family:inherit]",
          "hover:bg-accent hover:text-foreground aria-[current=true]:bg-accent aria-[current=true]:font-medium aria-[current=true]:text-foreground", nested ? "pl-6" : "pl-2", focusRing)}>
        <SquareTerminal aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{name(id)}</span>
      </button>
    </li>
  );
  const sideLabel = t(bottom ? "terminal.moveSide" : "terminal.moveBottom");

  return <aside ref={panelRef} className="@container box-border flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-solid border-border bg-terminal text-xs text-terminal-foreground data-[placement=overlay]:shadow-lg"
    data-testid="terminal-panel" data-placement={placement} data-thread-id={threadId ?? undefined} data-running={running} data-active-terminal={ready ? active : undefined}
    aria-labelledby={headingId} tabIndex={-1}>
    <header className="flex min-w-0 shrink-0 items-center gap-1 border-0 border-b border-solid border-border py-1.5 pl-3 pr-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <strong id={headingId} className="sr-only">{t("terminal.title")}</strong>
        <SquareTerminal aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-muted-foreground" title={cwd}>{cwd?.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || cwd}</span>
        {ready && ids.length > 1 && <span className="shrink-0 text-muted-foreground/70">· {name(active)}</span>}
      </div>
      {!listShown && toolbar}
      <Button variant="ghost" size="sm" data-testid="terminal-restart" disabled={!ready || opening} onClick={() => void restart()}>{t("terminal.restart")}</Button>
      <ToolButton icon={bottom ? <PanelRight /> : <PanelBottom />} label={sideLabel} testId="terminal-placement" extra={{ "data-target": bottom ? "side" : "bottom" }} onClick={() => moveTerminal(threadId, bottom ? "side" : "bottom")} />
      {bottom && threadId !== null && <ToolButton icon={<ChevronDown />} label={t("terminal.hide")} testId="terminal-hide" onClick={() => terminalLayout.setOpen(threadId, false)} />}
    </header>
    <div className="flex min-h-0 min-w-0 flex-1">
      {ready ? (
        <div className="flex min-h-0 min-w-0 flex-1 p-1.5">
          <PaneGroup key={group.id} group={group} threadId={threadId} renderPane={id => (
            <TerminalPane threadId={threadId} terminalId={id} cwd={cwd} active={id === active} ring={group.terminalIds.length > 1} revision={revisions[id] ?? 0} placement={placement}
              onActivate={() => terminalLayout.activate(threadId, id)}
              onStatus={next => setStatuses(current => ({ ...current, [id]: next }))}
              onReporter={writer => { if (writer === null) reporters.current.delete(id); else reporters.current.set(id, writer); }} />
          )} />
        </div>
      ) : <p className="m-0 p-3 leading-normal text-muted-foreground">{t("terminal.empty")}</p>}
      {listShown && (
        <nav className="flex w-44 min-w-0 shrink-0 flex-col @max-[560px]:w-38 border-0 border-l border-solid border-border" aria-label={t("terminal.list.label")} data-testid="terminal-list">
          <div className="flex shrink-0 justify-end border-0 border-b border-solid border-border p-1">{toolbar}</div>
          <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-0.5 overflow-y-auto p-1">
            {layout.groups.map(entry => entry.terminalIds.length === 1 ? row(entry.terminalIds[0]!, false) : (
              <li key={entry.id} className="flex flex-col gap-0.5" data-testid="terminal-group" data-split={entry.splitDirection}>
                <span className="flex h-7 items-center gap-2 px-2 text-muted-foreground">
                  {entry.splitDirection === "horizontal" ? <Columns2 aria-hidden className="size-3.5 shrink-0" /> : <Rows2 aria-hidden className="size-3.5 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">{t(entry.splitDirection === "horizontal" ? "terminal.group.horizontal" : "terminal.group.vertical")}</span>
                  <span className="shrink-0 tabular-nums">{entry.terminalIds.length}</span>
                </span>
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">{entry.terminalIds.map(id => row(id, true))}</ul>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
    {ready && !running && !opening && <footer className="shrink-0 border-0 border-t border-solid border-border px-3 py-2"><p className="m-0 leading-normal text-muted-foreground">{t("terminal.stopped")}</p></footer>}
  </aside>;
}

/**
 * The terminal panel of the main thread: the active group's panes split side by side or stacked, the terminal list with
 * its toolbar, and the placement switch. It renders in the bottom drawer or in the side panel's terminal tab.
 */
export function TerminalPanel({ placement }: { placement: TerminalPanelPlacement }) {
  const threadId = useAppSelector(selectMainThreadId);
  const cwd = useAppSelector(state => threadId === null ? undefined : state.threads[threadId]?.cwd);
  return <ThreadTerminals key={threadId ?? ""} threadId={threadId} cwd={cwd} placement={placement} />;
}
