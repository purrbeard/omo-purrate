import { useState } from "react";
import {
  IconChecklistOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  IconGoalOutlineRegular,
  StateDot,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { TodoPhase, WireGoal } from "../../../shared/protocol";
import { useT, type MessageKey } from "../../i18n";
import { selectDagRuns, selectGoal, selectTasks, selectThreadLiveState, selectTodo } from "../../state";
import { BackgroundWorkStrip } from "../composer/BackgroundWorkStrip";
import { useActions, useAppSelector } from "../app-context";
import { TESTID } from "../testids";
import { currentTodo, goalVisible, todoCounts, todoDot, workSummary, type TodoStatus } from "./activity-model";
import { formatWholeSeconds } from "./format";
import css from "./ConversationDock.module.css";

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
    <section className={css.card} data-testid={TESTID.todoDock} data-source={restored ? "history" : "live"} data-open={open || undefined} aria-label={t("todo.title")}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={t(open ? "todo.collapse" : "todo.expand")}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={css.lead} aria-hidden>
          <IconChecklistOutlineRegular size={14} />
        </span>
        <span className={css.title}>{t("todo.title")}</span>
        <span className={css.progress}>
          {t("todo.progress", { done: counts.done, total: counts.total })}
          {counts.abandoned > 0 && ` · ${t("todo.abandoned", { count: counts.abandoned })}`}
        </span>
        {!open && current !== null && <span className={css.current}>{current}</span>}
        {restored && <span className={css.tag}>{t("todo.restored")}</span>}
        <span className={css.chevron} aria-hidden>
          {open ? <IconChevronDownOutlineRegular size={14} /> : <IconChevronUpOutlineRegular size={14} />}
        </span>
      </button>
      {open && (
        <div className={css.phases}>
          {phases.map((phase, index) => {
            const phaseCounts = todoCounts([phase]);
            return (
              <div key={`${index}:${phase.name}`} className={css.phase} data-testid={TESTID.todoPhase}>
                <div className={css.phaseHeader}>
                  <span className={css.phaseName}>{phase.name}</span>
                  <span className={css.phaseCount}>{`${phaseCounts.done}/${phaseCounts.total}`}</span>
                </div>
                <ul className={css.list}>
                  {phase.tasks.map((item, itemIndex) => (
                    <li key={`${itemIndex}:${item.content}`} className={css.item} data-testid={TESTID.todoItem} data-status={item.status}>
                      <span className={css.glyph} role="img" aria-label={t(TODO_LABELS[item.status])}>
                        <StateDot state={todoDot(item.status, live)} />
                      </span>
                      <span className={css.content} title={item.content}>
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
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  };
  if (!goalVisible(goal)) return null;
  const elapsed = formatWholeSeconds(goal.timeUsedSeconds * 1000, t);
  return (
    <section className={css.goal} data-testid={TESTID.goalStrip} data-status={goal.status} aria-label={t("goal.region")}>
      <span className={css.lead} aria-hidden>
        <IconGoalOutlineRegular size={14} />
      </span>
      <span className={css.title}>{t(GOAL_LABELS[goal.status])}</span>
      <span className={css.objective} title={goal.objective}>
        {goal.objective}
      </span>
      <span className={css.elapsed} aria-label={t("goal.elapsed", { duration: elapsed })}>
        {elapsed}
      </span>
      <span className={css.goalActions}>
        {goal.status === "active" && <button type="button" disabled={pending} data-testid={TESTID.goalPause} onClick={() => void change("paused")}>{t("goal.pause")}</button>}
        {goal.status === "paused" && <button type="button" disabled={pending} data-testid={TESTID.goalResume} onClick={() => void change("active")}>{t("goal.resume")}</button>}
        <button type="button" disabled={pending} data-testid={TESTID.goalClear} onClick={() => void change(null)}>{t("goal.clear")}</button>
      </span>
      {error !== null && <span className={css.goalError} data-testid={TESTID.goalError} role="alert">{error}</span>}
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
    <div className={css.dock} data-testid="composer-status-line" role="group" aria-label={t("conversation.statusLine")}>
      {hasTodo && <TodoDock phases={todo.phases} restored={todo.source === "history"} live={live && todo.source === "live"} />}
      <GoalStrip key={threadId} goal={goal} threadId={threadId} />
      {background && <BackgroundWorkStrip threadId={threadId} />}
    </div>
  );
}

const EMPTY: readonly never[] = [];
