import { useEffect, useRef, useState } from "react";
import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import { useLocale, useT, type MessageKey } from "../../i18n";
import { selectDagRuns, selectThreadLiveState } from "../../state";
import { useAppSelector } from "../app-context";
import { useUiState } from "../ui-state";
import { knownNodeState, nodeDot, type NodeState } from "./activity-model";
import { observeWorkflow, type WorkflowTransition } from "./workflow-activity";
import css from "./WorkflowPanel.module.css";

const STATUS_LABELS = {
  pending: "activity.node.pending", blocked: "activity.node.blocked", scheduled: "activity.node.scheduled",
  running: "activity.node.running", completed: "activity.node.completed", failed: "activity.node.failed",
  cancelled: "activity.node.cancelled", skipped: "activity.node.skipped",
} as const satisfies Record<NodeState, MessageKey>;

/** Observed live transitions only. The parent keys this observer by thread so logs cannot cross conversations. */
export function WorkflowActivity({ threadId }: { threadId: string }) {
  const t = useT();
  const locale = useLocale();
  const timeFormat = useUiState().preferences?.timeFormat ?? "system";
  const runs = useAppSelector(state => selectDagRuns(state, threadId));
  const live = useAppSelector(state => selectThreadLiveState(state, threadId)?.freshness === "live");
  const previous = useRef(new Map<string, string>());
  const attached = useRef(false);
  const [entries, setEntries] = useState<WorkflowTransition[]>([]);
  useEffect(() => {
    const observation = observeWorkflow(runs, attached.current && live ? previous.current : new Map(), Date.now());
    previous.current = observation.states;
    attached.current = live;
    if (observation.transitions.length > 0) {
      setEntries(current => [...observation.transitions.reverse(), ...current].slice(0, 50));
    }
  }, [runs, live]);
  return <details className={css.activity} data-testid="workflow-activity-log">
    <summary>{t("activity.log.title")} <span>{entries.length}</span></summary>
    {entries.length === 0 ? <p className={css.empty}>{t("activity.log.empty")}</p> : <ul className={css.activityList}>
      {entries.map((entry, index) => {
        const status = knownNodeState(entry.state);
        return <li key={`${entry.runId}:${entry.nodeId}:${entry.atMs}:${index}`} data-testid="workflow-activity-entry" data-state={entry.state}>
          <StateDot state={nodeDot(entry.state, false)} size={8} />
          <span className={css.activityLabel} title={`${entry.runId} · ${entry.label}`}>{entry.label}</span>
          <span>{status === null ? entry.state : t(STATUS_LABELS[status])}</span>
          <time dateTime={new Date(entry.atMs).toISOString()}>{new Date(entry.atMs).toLocaleTimeString(locale, {
            hour: "2-digit", minute: "2-digit", ...(timeFormat === "system" ? {} : { hourCycle: timeFormat === "24h" ? "h23" : "h12" }),
          })}</time>
        </li>;
      })}
    </ul>}
  </details>;
}
