import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, ListTree } from "lucide-react";
import clsx from "clsx";
import { useT, type MessageKey, type Translate } from "../../i18n";
import { IconButton, Menu, StateDot, Tooltip, focusRing } from "../kit";
import { knownTaskStatus, taskDot, taskRoute, taskTitle, type ActivityTask, type TaskStatus } from "./activity-model";

const TASK_LABELS = {
  pending: "activity.task.pending", running: "activity.task.running", completed: "activity.task.completed",
  error: "activity.task.error", cancelled: "activity.task.cancelled", interrupted: "activity.task.interrupted", lost: "activity.task.lost",
} as const satisfies Record<TaskStatus, MessageKey>;

/** Share of the visible strip one arrow press scrolls, like a browser tab strip. */
const ARROW_PAGE = 0.75;
const ARROW = "my-auto size-7! flex-none text-muted-foreground [&_svg]:size-4";

export function agentTabLabel(task: ActivityTask): string {
  return task.name?.trim() || task.agent_type || task.category || task.task_id;
}

function statusText(status: string, t: Translate): string {
  const known = knownTaskStatus(status);
  return known === null ? status : t(TASK_LABELS[known]);
}

/** Whether the rail hides tabs to its left or right. */
function useOverflow(rail: HTMLDivElement | null, revision: number): { left: boolean; right: boolean } {
  const [overflow, setOverflow] = useState({ left: false, right: false });
  useEffect(() => {
    if (rail === null) return;
    const measure = (): void => {
      const left = rail.scrollLeft > 1;
      const right = rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 1;
      setOverflow((previous) => (previous.left === left && previous.right === right ? previous : { left, right }));
    };
    measure();
    rail.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(rail);
    return () => {
      rail.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [rail, revision]);
  return overflow;
}

/**
 * The agent tabs as a horizontal scroll rail: the wheel scrolls it sideways, arrows appear only while tabs are
 * hidden on that side, the selected tab scrolls into view, and "All agents" jumps to any agent (closed ones too).
 */
export function AgentTabStrip({ open, all, selectedId, closedCount, live, onSelect, onClose, onReopen }: {
  open: readonly ActivityTask[]; all: readonly ActivityTask[]; selectedId: string | undefined; closedCount: number; live: boolean;
  onSelect: (taskId: string) => void; onClose: (taskId: string) => void; onReopen: () => void;
}) {
  const t = useT();
  const [rail, setRail] = useState<HTMLDivElement | null>(null);
  const overflow = useOverflow(rail, open.length);
  const [menuOpen, setMenuOpen] = useState(false);
  /** The selected tab still to be revealed; the user scrolling the rail by hand cancels it. */
  const reveal = useRef<string | undefined>(undefined);
  const page = useCallback((direction: 1 | -1) => {
    reveal.current = undefined;
    if (rail !== null) rail.scrollBy({ left: direction * rail.clientWidth * ARROW_PAGE, behavior: "smooth" });
  }, [rail]);
  // React registers wheel listeners as passive, so the vertical-to-horizontal mapping needs a native listener.
  useEffect(() => {
    if (rail === null) return;
    const wheel = (event: WheelEvent): void => {
      if (rail.scrollWidth <= rail.clientWidth || event.ctrlKey) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (delta === 0) return;
      event.preventDefault();
      reveal.current = undefined;
      rail.scrollLeft += event.deltaMode === WheelEvent.DOM_DELTA_LINE ? delta * 16 : delta;
    };
    rail.addEventListener("wheel", wheel, { passive: false });
    return () => rail.removeEventListener("wheel", wheel);
  }, [rail]);
  useEffect(() => { reveal.current = selectedId; }, [selectedId]);
  useEffect(() => {
    if (selectedId === undefined || rail === null || reveal.current !== selectedId) return;
    const tab = document.getElementById(`agent-tab-${selectedId}`)?.parentElement;
    if (tab == null) return;
    // Scroll only the rail (scrollIntoView would also move the dock's ancestors), and at once: an arrow appearing or
    // leaving resizes the rail, so the reveal repeats when the arrows change until the user scrolls by hand.
    const start = tab.offsetLeft;
    const end = start + tab.offsetWidth;
    if (start < rail.scrollLeft) rail.scrollLeft = start;
    else if (end > rail.scrollLeft + rail.clientWidth) rail.scrollLeft = end - rail.clientWidth;
  }, [selectedId, rail, open.length, overflow.left, overflow.right]);
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = open.findIndex((task) => task.task_id === selectedId);
    const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const next = offset !== 0 ? open[(index + offset + open.length) % open.length]
      : event.key === "Home" ? open[0] : event.key === "End" ? open.at(-1) : undefined;
    if (next === undefined) return;
    event.preventDefault();
    onSelect(next.task_id);
    document.getElementById(`agent-tab-${next.task_id}`)?.focus();
  };
  return (
    <div className="flex shrink-0 items-stretch gap-0.5 border-0 border-b border-solid border-border px-1" data-testid="agent-tab-strip"
      data-overflow-left={overflow.left || undefined} data-overflow-right={overflow.right || undefined}>
      {overflow.left && <IconButton className={ARROW} icon={<ChevronLeft aria-hidden />} label={t("activity.tabs.scrollLeft")}
        data-testid="agent-tabs-left" onClick={() => page(-1)} />}
      <div ref={setRail} className="relative flex min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist" aria-label={t("activity.agents")} onKeyDown={keys} data-testid="agent-tab-rail">
        {open.map((task) => {
          const label = agentTabLabel(task);
          const status = statusText(task.status, t);
          const selected = task.task_id === selectedId;
          return (
            <div key={task.task_id} className="flex max-w-48 min-w-0 shrink-0 items-center">
              <Tooltip.Root>
                <Tooltip.Trigger render={
                  <button id={`agent-tab-${task.task_id}`} type="button" role="tab"
                    className={clsx("m-0 flex min-h-10 min-w-0 cursor-pointer items-center gap-[7px] border-0 border-b-2 border-solid border-transparent bg-transparent py-2 pr-1 pl-2.5 whitespace-nowrap text-muted-foreground [font-family:inherit] hover:text-foreground aria-selected:border-foreground aria-selected:text-foreground", focusRing)}
                    aria-selected={selected} aria-controls="agent-chat-panel" tabIndex={selected ? 0 : -1}
                    data-testid="agent-chat-tab" data-task-id={task.task_id} data-status={task.status} onClick={() => onSelect(task.task_id)} />
                }>
                  <StateDot state={taskDot(task.status, live)} size={task.status === "running" && live ? 12 : 8} />
                  <span className="min-w-0 truncate">{label}</span>
                </Tooltip.Trigger>
                <Tooltip.Content side="bottom" className="max-w-80" data-testid="agent-tab-tooltip">
                  <span className="block font-semibold [overflow-wrap:anywhere]">{taskTitle(task)}</span>
                  <span className="block font-normal opacity-80 [overflow-wrap:anywhere]">{[label, status, ...taskRoute(task)].join(" · ")}</span>
                </Tooltip.Content>
              </Tooltip.Root>
              <button type="button" className={clsx("m-0 min-h-10 flex-none cursor-pointer border-0 bg-transparent px-1.5 text-muted-foreground hover:text-foreground", focusRing)}
                aria-label={`${label} · ${t("activity.closeAgents")}`} onClick={() => onClose(task.task_id)}>×</button>
            </div>
          );
        })}
        {closedCount > 0 && <button className={clsx("m-0 min-h-10 shrink-0 cursor-pointer border-0 bg-transparent px-2 whitespace-nowrap text-muted-foreground [font-family:inherit] hover:text-foreground", focusRing)}
          type="button" onClick={onReopen}>+ {t("activity.agents")}</button>}
      </div>
      {overflow.right && <IconButton className={ARROW} icon={<ChevronRight aria-hidden />} label={t("activity.tabs.scrollRight")}
        data-testid="agent-tabs-right" onClick={() => page(1)} />}
      {all.length > 1 && <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Menu.Trigger className={clsx("m-0 my-auto grid size-7 flex-none cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent [&_svg]:size-4", focusRing)}
          aria-label={t("activity.allAgents", { count: all.length })} title={t("activity.allAgents", { count: all.length })} data-testid="agent-tabs-all">
          <ListTree aria-hidden />
        </Menu.Trigger>
        <Menu.Content align="end" className="max-h-[min(420px,var(--available-height))] w-72" data-testid="agent-tabs-menu">
          <Menu.Group>
          <Menu.GroupLabel>{t("activity.allAgents", { count: all.length })}</Menu.GroupLabel>
          {all.map((task) => (
            <Menu.Item key={task.task_id} data-testid="agent-tabs-menu-item" data-task-id={task.task_id}
              className={clsx("min-w-0", task.task_id === selectedId && "bg-accent/60")} onClick={() => onSelect(task.task_id)}>
              <StateDot state={taskDot(task.status, live)} size={8} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs font-medium">{agentTabLabel(task)}</span>
                <span className="truncate text-[11px] text-muted-foreground">{taskTitle(task)}</span>
              </span>
              <span className="flex-none text-[11px] text-muted-foreground">{statusText(task.status, t)}</span>
            </Menu.Item>
          ))}
          </Menu.Group>
        </Menu.Content>
      </Menu.Root>}
    </div>
  );
}
