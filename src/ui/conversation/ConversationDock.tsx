import { useState } from "react";
import type { TodoPhase, WireGoal } from "../../../shared/protocol";
import { useT, type MessageKey } from "../../i18n";
import { selectDagRuns, selectGoal, selectTasks, selectThreadLiveState, selectTodo } from "../../state";
import { BackgroundWorkStrip } from "../composer/BackgroundWorkStrip";
import { useActions, useAppSelector } from "../app-context";
import { TESTID } from "../testids";
import { currentTodo, goalVisible, todoCounts, todoDot, workSummary, type TodoStatus } from "./activity-model";
import { formatWholeSeconds } from "./format";
import clsx from "clsx";
import { ChevronDown, ChevronUp, CircleAlert, ListChecks, Target } from "lucide-react";
import { StateDot, focusRing } from "../kit";
import { userErrorText } from "./user-error";

const goalButton = clsx("m-0 cursor-pointer rounded-sm border-0 bg-muted px-1.5 py-0.5 text-xs text-muted-foreground [font-family:inherit] hover:text-foreground disabled:cursor-default disabled:opacity-50", focusRing);
const lead = "grid flex-none place-items-center text-muted-foreground";
const title = "flex-none text-[13px] font-medium leading-6 whitespace-nowrap text-foreground";

const TODO_LABELS = {
  pending: "todo.status.pending",
  in_progress: "todo.status.in_progress",
  completed: "todo.status.completed",
  abandoned: "todo.status.abandoned",
} as const satisfies Record<TodoStatus, MessageKey>;

const GOAL_LABELS = {
  active: "goal.status.active",
  paused: "goal.status.paused",
  blocked: "goal.status.blocked",
  complete: "goal.status.complete",
} as const satisfies Record<WireGoal["status"], MessageKey>;

/** Collapsible phased todo list; starts collapsed and renders nothing for an empty list. */
export function TodoDock({ phases, restored, live }: { phases: readonly TodoPhase[]; restored: boolean; live: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const counts = todoCounts(phases);
  if (counts.total === 0) return null;
  const current = currentTodo(phases);
  return (
    <section className="box-border overflow-hidden border-0 data-[open]:order-1 data-[open]:basis-full data-[open]:border-t data-[open]:border-l-0 data-[open]:border-solid data-[open]:border-border data-[open]:first:border-t-0" data-testid={TESTID.todoDock} data-source={restored ? "history" : "live"} data-open={open || undefined} aria-label={t("todo.title")}>
      <button
        type="button"
        className={clsx("m-0 flex h-9 w-full min-w-0 cursor-pointer items-center gap-2.5 border-0 bg-transparent px-3 text-left [font-family:inherit]", focusRing)}
        aria-expanded={open}
        aria-label={t(open ? "todo.collapse" : "todo.expand")}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={lead} aria-hidden>
          <ListChecks className="size-3.5" aria-hidden />
        </span>
        <span className={title}>{t("todo.title")}</span>
        <span className="flex-none text-[13px] leading-5 whitespace-nowrap text-muted-foreground">
          {t("todo.progress", { done: counts.done, total: counts.total })}
          {counts.abandoned > 0 && ` · ${t("todo.abandoned", { count: counts.abandoned })}`}
        </span>
        {!open && current !== null && <span className="min-w-0 flex-auto truncate text-[13px] leading-5 text-muted-foreground">{current}</span>}
        {restored && <span className={clsx("flex-none rounded-sm bg-muted px-1.5 text-[11px] leading-[18px] whitespace-nowrap text-muted-foreground", (open || current === null) && "ml-auto")}>{t("todo.restored")}</span>}
        <span className={clsx(lead, !restored && "ml-auto")} aria-hidden>
          {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronUp className="size-3.5" aria-hidden />}
        </span>
      </button>
      {open && (
        <div className="flex max-h-[min(200px,28vh)] flex-col gap-2 overflow-y-auto px-3 pb-2.5">
          {phases.map((phase, index) => {
            const phaseCounts = todoCounts([phase]);
            return (
              <div key={`${index}:${phase.name}`} className="flex min-w-0 flex-col gap-1" data-testid={TESTID.todoPhase}>
                <div className="flex items-center gap-2 text-xs font-medium leading-[18px] text-muted-foreground">
                  <span className="min-w-0 truncate">{phase.name}</span>
                  <span className="flex-none font-normal tabular-nums">{`${phaseCounts.done}/${phaseCounts.total}`}</span>
                </div>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {phase.tasks.map((item, itemIndex) => (
                    <li key={`${itemIndex}:${item.content}`} className="group/todo flex min-w-0 items-center gap-2.5 text-[13px] leading-5 text-muted-foreground data-[status=in_progress]:font-medium data-[status=in_progress]:text-foreground data-[status=completed]:opacity-70 data-[status=abandoned]:opacity-70" data-testid={TESTID.todoItem} data-status={item.status}>
                      <span className="grid size-4 flex-none place-items-center" role="img" aria-label={t(TODO_LABELS[item.status])}>
                        <StateDot state={todoDot(item.status, live)} />
                      </span>
                      <span className="min-w-0 truncate group-data-[status=abandoned]/todo:line-through" title={item.content}>
                        {item.content}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Goal controls; hidden while the goal is unknown (undefined) or absent (null). */
export function GoalStrip({ goal, threadId }: { goal: WireGoal | null | undefined; threadId: string }) {
  const t = useT();
  const actions = useActions();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = async (status: "active" | "paused" | null): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      if (status === null) await actions.clearGoal(threadId);
      else await actions.setGoalStatus(threadId, status);
    } catch (reason) {
      setError(userErrorText(reason, t("conversation.error.requestFailed")).text);
    } finally {
      setPending(false);
    }
  };
  if (!goalVisible(goal)) return null;
  const elapsed = formatWholeSeconds(goal.timeUsedSeconds * 1000, t);
  return (
    <section className="box-border flex min-h-9 flex-wrap items-center gap-2.5 border-0 px-3 py-1" data-testid={TESTID.goalStrip} data-status={goal.status} aria-label={t("goal.region")}>
      <span className={lead} aria-hidden>
        <Target className="size-3.5" aria-hidden />
      </span>
      <span className={title}>{t(GOAL_LABELS[goal.status])}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-foreground/80" title={goal.objective}>
        {goal.objective}
      </span>
      <span className="flex-none text-xs leading-[18px] text-muted-foreground tabular-nums" aria-label={t("goal.elapsed", { duration: elapsed })}>
        {elapsed}
      </span>
      <span className="ml-auto flex flex-none gap-1.5">
        {goal.status === "active" && <button type="button" className={goalButton} disabled={pending} data-testid={TESTID.goalPause} onClick={() => void change("paused")}>{t("goal.pause")}</button>}
        {goal.status === "paused" && <button type="button" className={goalButton} disabled={pending} data-testid={TESTID.goalResume} onClick={() => void change("active")}>{t("goal.resume")}</button>}
        <button type="button" className={goalButton} disabled={pending} data-testid={TESTID.goalClear} onClick={() => void change(null)}>{t("goal.clear")}</button>
      </span>
      {error !== null && <span className="flex basis-full items-start gap-1.5 text-xs [overflow-wrap:anywhere] text-destructive-foreground" data-testid={TESTID.goalError} role="alert"><CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />{error}</span>}
    </section>
  );
}

/** One status line above the composer card for the active thread: todo progress, goal, then running background work. */
export function ConversationDock() {
  const t = useT();
  const threadId = useAppSelector((state) => state.activeThreadId);
  const todo = useAppSelector((state) => (threadId === null ? null : selectTodo(state, threadId)));
  const goal = useAppSelector((state) => (threadId === null ? undefined : selectGoal(state, threadId)));
  const live = useAppSelector((state) => threadId !== null && selectThreadLiveState(state, threadId)?.freshness === "live");
  const runs = useAppSelector((state) => (threadId === null ? EMPTY : selectDagRuns(state, threadId)));
  const tasks = useAppSelector((state) => (threadId === null ? EMPTY : selectTasks(state, threadId)));
  const background = workSummary(runs, tasks, live).running > 0;
  const hasTodo = todo !== null && todoCounts(todo.phases).total > 0;
  if (threadId === null || (!hasTodo && !goalVisible(goal) && !background)) return null;
  return (
    <div className="mb-2 box-border flex w-[calc(100%-24px)] max-w-[calc(var(--dsh-composer-card-max-width,760px)-24px)] flex-wrap items-stretch overflow-hidden rounded-lg border border-solid border-border bg-popover text-popover-foreground shadow-md [&>*]:min-w-40 [&>*]:flex-[1_1_0] [&>*+*]:border-0 [&>*+*]:border-l [&>*+*]:border-solid [&>*+*]:border-border" data-testid="composer-status-line" role="group" aria-label={t("conversation.statusLine")}>
      {hasTodo && <TodoDock phases={todo.phases} restored={todo.source === "history"} live={live && todo.source === "live"} />}
      <GoalStrip key={threadId} goal={goal} threadId={threadId} />
      {background && <BackgroundWorkStrip threadId={threadId} />}
    </div>
  );
}

const EMPTY: readonly never[] = [];
