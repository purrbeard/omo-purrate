import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import type { LiveTask } from "../../../shared/protocol";
import { useT, type MessageKey } from "../../i18n";
import { isSuspended, knownTaskStatus, taskDot, taskRoute, taskTitle } from "./activity-model";
import { formatDuration } from "./format";
import css from "./TurnView.module.css";

const STATUS_LABELS = {
  pending: "activity.task.pending", running: "activity.task.running", completed: "activity.task.completed",
  error: "activity.task.error", cancelled: "activity.task.cancelled", interrupted: "activity.task.interrupted", lost: "activity.task.lost",
} as const satisfies Record<NonNullable<ReturnType<typeof knownTaskStatus>>, MessageKey>;

export function SubagentRow({ task, live }: { task: LiveTask; live: boolean }) {
  const t = useT();
  const status = knownTaskStatus(task.status);
  const executing = live && !isSuspended(task);
  const state = isSuspended(task) && task.status === "running" ? t("activity.task.suspended") :
    status === null ? task.status : t(STATUS_LABELS[status]);
  const runtime = task.run_stats?.runtime_ms;
  return (
    <li className={css.subagentRow} data-task-id={task.task_id} data-status={task.status} data-live={executing || undefined}>
      <StateDot state={taskDot(task.status, executing)} size={10} />
      <span className={css.subagentTitle}>{taskTitle(task)}</span>
      <span className={css.subagentMeta}>{taskRoute(task).join(" · ")}</span>
      <span className={css.subagentMeta}>{state}{!live && task.status === "running" ? ` · ${t("conversation.subagents.stale")}` : ""}</span>
      {runtime !== undefined && Number.isFinite(runtime) && runtime >= 0 && <span className={css.subagentMeta}>{formatDuration(runtime, t)}</span>}
    </li>
  );
}
