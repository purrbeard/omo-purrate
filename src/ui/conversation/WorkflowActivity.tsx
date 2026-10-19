import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import { useLocale, useT, type MessageKey } from "../../i18n";
import { selectThreadLiveState } from "../../state";
import { useAppSelector } from "../app-context";
import { useUiState } from "../ui-state";
import { knownNodeState, nodeDot, type NodeState } from "./activity-model";
import clsx from "clsx";
import { focusRing } from "../kit";

const STATUS_LABELS = {
  pending: "activity.node.pending", blocked: "activity.node.blocked", scheduled: "activity.node.scheduled",
  running: "activity.node.running", completed: "activity.node.completed", failed: "activity.node.failed",
  cancelled: "activity.node.cancelled", skipped: "activity.node.skipped",
} as const satisfies Record<NodeState, MessageKey>;

/** Pure view of the selected thread's retained, observed live transitions. */
export function WorkflowActivity({ threadId }: { threadId: string }) {
  const t = useT();
  const locale = useLocale();
  const timeFormat = useUiState().preferences?.timeFormat ?? "system";
  const entries = useAppSelector(state => selectThreadLiveState(state, threadId))?.activityLog ?? [];
  return <details open className="m-3 border-0 border-t border-solid border-border" data-testid="workflow-activity-log">
    <summary className={clsx("flex cursor-pointer items-center gap-2 py-3 [&>span]:text-muted-foreground", focusRing)}>{t("activity.log.title")} <span>{entries.length}</span></summary>
    {entries.length === 0 ? <p className="m-0 p-4 text-muted-foreground">{t("activity.log.empty")}</p> : <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {entries.map((entry, index) => {
        const status = knownNodeState(entry.state);
        return <li key={`${entry.runId}:${entry.nodeId}:${entry.atMs}:${index}`} className="flex min-w-0 items-center gap-2" data-testid="workflow-activity-entry" data-state={entry.state}>
          <StateDot state={nodeDot(entry.state, false)} size={8} />
          <span className="min-w-0 flex-1 truncate" title={`${entry.runId} · ${entry.label}`}>{entry.label}</span>
          <span>{status === null ? entry.state : t(STATUS_LABELS[status])}</span>
          <time className="text-muted-foreground tabular-nums" dateTime={new Date(entry.atMs).toISOString()}>{new Date(entry.atMs).toLocaleTimeString(locale, {
            hour: "2-digit", minute: "2-digit", ...(timeFormat === "system" ? {} : { hourCycle: timeFormat === "24h" ? "h23" : "h12" }),
          })}</time>
        </li>;
      })}
    </ul>}
  </details>;
}
