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
import { selectGoal, selectThreadLiveState, selectTodo } from "../../state";
import { useAppSelector } from "../app-context";
import { TESTID } from "../testids";
import { currentTodo, goalVisible, todoCounts, todoDot, type TodoStatus } from "./activity-model";
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
    <section className={css.card} data-testid={TESTID.todoDock} data-source={restored ? "history" : "live"} aria-label={t("todo.title")}>
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

/** Display-only goal strip; hidden while the goal is unknown (undefined) or absent (null). */
export function GoalStrip({ goal }: { goal: WireGoal | null | undefined }) {
  const t = useT();
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
    </section>
  );
}

/** The stack above the composer card for the active thread: todo list, then goal. */
export function ConversationDock() {
  const threadId = useAppSelector((state) => state.activeThreadId);
  const todo = useAppSelector((state) => (threadId === null ? null : selectTodo(state, threadId)));
  const goal = useAppSelector((state) => (threadId === null ? undefined : selectGoal(state, threadId)));
  const live = useAppSelector((state) => threadId !== null && selectThreadLiveState(state, threadId)?.freshness === "live");
  if (threadId === null || (todo === null && !goalVisible(goal))) return null;
  return (
    <div className={css.dock}>
      {todo !== null && <TodoDock phases={todo.phases} restored={todo.source === "history"} live={live && todo.source === "live"} />}
      <GoalStrip goal={goal} />
    </div>
  );
}
