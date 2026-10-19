import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import type { LiveTask } from "../../../shared/protocol";
import { useT, type MessageKey } from "../../i18n";
import { isSuspended, knownTaskStatus, taskDot, taskRoute, taskTitle } from "./activity-model";
import { formatDuration } from "./format";

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
    <li className="flex min-w-0 flex-wrap items-center gap-2 [&>:first-child]:shrink-0" data-task-id={task.task_id} data-status={task.status} data-live={executing || undefined}>
      <StateDot state={taskDot(task.status, executing)} size={10} />
      <span className="min-w-0 flex-[1_1_160px] text-foreground [overflow-wrap:anywhere]">{taskTitle(task)}</span>
      <span className="text-muted-foreground [overflow-wrap:anywhere]">{taskRoute(task).join(" · ")}</span>
      <span className="text-muted-foreground [overflow-wrap:anywhere]">{state}{!live && task.status === "running" ? ` · ${t("conversation.subagents.stale")}` : ""}</span>
      {runtime !== undefined && Number.isFinite(runtime) && runtime >= 0 && <span className="text-muted-foreground [overflow-wrap:anywhere]">{formatDuration(runtime, t)}</span>}
    </li>
  );
}
