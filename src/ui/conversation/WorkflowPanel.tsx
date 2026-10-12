import { useT } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useAppSelector } from "../app-context";
import { uiState, useUiState } from "../ui-state";
import type { WorkView } from "../ui-state";
import { ActivityPanel } from "./ActivityPanel";
import { AgentWorkspace } from "./AgentWorkspace";
import { WorkflowActivity } from "./WorkflowActivity";
import css from "./WorkflowPanel.module.css";

const VIEWS: readonly { id: WorkView; label: MessageKey; testId: string }[] = [
  { id: "agents", label: "activity.agents", testId: "workflow-agents-view" },
  { id: "graph", label: "activity.graph", testId: "workflow-graph-view" },
  { id: "list", label: "activity.list", testId: "workflow-list" },
  { id: "activity", label: "activity.log.title", testId: "workflow-log-view" },
];

/** The Work panel: agent conversations, the run graph, the work list and the activity log of the active thread. */
export function WorkflowPanel({ placement }: { placement: "docked" | "overlay" }) {
  const t = useT();
  const threadId = useAppSelector(state => state.activeThreadId);
  const { workflowPanelSize, workView } = useUiState();
  return <section id="workflow-panel" className={css.panel} data-testid="workflow-panel" data-placement={placement} data-size={workflowPanelSize} data-view={workView}
    aria-label={t("activity.work")}>
    <nav className={css.views} aria-label={t("activity.view")}>
      <div role="tablist" aria-label={t("activity.view")}>
        {VIEWS.map(view => <button key={view.id} id={`workflow-tab-${view.id}`} type="button" role="tab" aria-selected={workView === view.id}
          aria-controls="workflow-content" data-testid={view.testId} onClick={() => uiState.setWorkView(view.id)}>{t(view.label)}</button>)}
      </div>
      <span className={css.spacer} />
      <button type="button" aria-pressed={workflowPanelSize === "wide"} data-testid="workflow-widen"
        onClick={() => uiState.setWorkflowPanelSize(workflowPanelSize === "wide" ? "normal" : "wide")}>{t("activity.widen")}</button>
      <button type="button" aria-pressed={workflowPanelSize === "maximized"} data-testid="workflow-maximize"
        onClick={() => uiState.setWorkflowPanelSize(workflowPanelSize === "maximized" ? "normal" : "maximized")}>{t("activity.maximize")}</button>
    </nav>
    <div id="workflow-content" className={css.body} role="tabpanel" aria-labelledby={`workflow-tab-${workView}`} data-view={workView}>
      {workView === "agents" ? <AgentWorkspace placement={placement} />
        : threadId === null ? <p className={css.empty}>{t("activity.selectThread")}</p>
        : workView === "activity" ? <WorkflowActivity key={`log:${threadId}`} threadId={threadId} />
        : <ActivityPanel key={threadId} threadId={threadId} id="workflow-activity" view={workView} docked />}
    </div>
  </section>;
}
