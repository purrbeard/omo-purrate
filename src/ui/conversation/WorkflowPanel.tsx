import { useT } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useAppSelector } from "../app-context";
import { uiState, useUiState } from "../ui-state";
import type { WorkView } from "../ui-state";
import { ActivityPanel } from "./ActivityPanel";
import { AgentWorkspace } from "./AgentWorkspace";
import { WorkflowActivity } from "./WorkflowActivity";
import clsx from "clsx";
import { focusRing } from "../kit";

const viewButton = clsx("m-0 cursor-pointer rounded-md border-0 bg-transparent px-2 py-1.5 text-xs text-muted-foreground [font-family:inherit] hover:bg-accent hover:text-accent-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground aria-selected:bg-accent aria-selected:text-accent-foreground", focusRing);

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
  return <section id="workflow-panel" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-solid border-border bg-background text-xs text-foreground data-[placement=overlay]:shadow-lg" data-testid="workflow-panel" data-placement={placement} data-size={workflowPanelSize} data-view={workView}
    aria-label={t("activity.work")}>
    <nav className="flex flex-none gap-1 border-0 border-b border-solid border-border px-3 py-2" aria-label={t("activity.view")}>
      <div className="flex gap-1" role="tablist" aria-label={t("activity.view")}>
        {VIEWS.map(view => <button key={view.id} id={`workflow-tab-${view.id}`} type="button" role="tab" className={viewButton} aria-selected={workView === view.id}
          aria-controls="workflow-content" data-testid={view.testId} onClick={() => uiState.setWorkView(view.id)}>{t(view.label)}</button>)}
      </div>
      <span className="flex-1" />
      <button type="button" className={viewButton} aria-pressed={workflowPanelSize === "wide"} data-testid="workflow-widen"
        onClick={() => uiState.setWorkflowPanelSize(workflowPanelSize === "wide" ? "normal" : "wide")}>{t("activity.widen")}</button>
      <button type="button" className={viewButton} aria-pressed={workflowPanelSize === "maximized"} data-testid="workflow-maximize"
        onClick={() => uiState.setWorkflowPanelSize(workflowPanelSize === "maximized" ? "normal" : "maximized")}>{t("activity.maximize")}</button>
    </nav>
    <div id="workflow-content" className={clsx("min-h-0 min-w-0 flex-1", workView === "agents" ? "flex overflow-hidden [&>section]:rounded-none [&>section]:border-0" : "overflow-auto")} role="tabpanel" aria-labelledby={`workflow-tab-${workView}`} data-view={workView}>
      {workView === "agents" ? <AgentWorkspace placement={placement} />
        : threadId === null ? <p className="m-0 p-4 text-muted-foreground">{t("activity.selectThread")}</p>
        : workView === "activity" ? <WorkflowActivity key={`log:${threadId}`} threadId={threadId} />
        : <ActivityPanel key={threadId} threadId={threadId} id="workflow-activity" view={workView} docked />}
    </div>
  </section>;
}
