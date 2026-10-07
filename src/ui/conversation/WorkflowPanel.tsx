import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { useAppSelector } from "../app-context";
import { uiState, useUiState } from "../ui-state";
import { ActivityPanel } from "./ActivityPanel";
import { WorkflowActivity } from "./WorkflowActivity";
import { threadTitle } from "./format";
import css from "./WorkflowPanel.module.css";

export function WorkflowPanel({ placement }: { placement: "docked" | "overlay" }) {
  const t = useT();
  const threadId = useAppSelector(state => state.activeThreadId);
  const thread = useAppSelector(state => state.activeThreadId === null ? null : state.threads[state.activeThreadId] ?? null);
  const title = threadTitle(thread, t("conversation.header.newSession"));
  const { workflowPanelSize } = useUiState();
  const [view, setView] = useState<"list" | "graph">("graph");
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    if (placement === "overlay") closeRef.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, [placement]);
  return <aside id="workflow-panel" ref={panelRef} className={css.panel} data-testid="workflow-panel" data-placement={placement} data-size={workflowPanelSize}
    role={placement === "overlay" ? "dialog" : "complementary"} aria-label={t("activity.workflow")}
    onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); uiState.setWorkflowPanelOpen(false); }
      if (placement === "overlay" && event.key === "Tab") {
        const controls = [...(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), summary, [tabindex="0"], input, select') ?? [])].filter(control => control.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first && last !== undefined) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last && first !== undefined) { event.preventDefault(); first.focus(); }
      }
    }}>
    <header className={css.header}>
      <div className={css.heading}><strong>{t("activity.workflow")}</strong><span title={title}>{title}</span></div>
      <button type="button" data-testid="workflow-files" onClick={() => uiState.setWorkspacePanelOpen(true)}>{t("shell.workspace.files")}</button>
      <button ref={closeRef} type="button" data-testid="workflow-close" aria-label={t("activity.close")} onClick={() => uiState.setWorkflowPanelOpen(false)}>×</button>
    </header>
    <nav className={css.views} aria-label={t("activity.view")}>
      <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} data-testid="workflow-list">{t("activity.list")}</button>
      <button type="button" aria-pressed={view === "graph"} onClick={() => setView("graph")} data-testid="workflow-graph-view">{t("activity.graph")}</button>
      <span className={css.spacer} />
      <button type="button" aria-pressed={workflowPanelSize === "wide"} data-testid="workflow-widen"
        onClick={() => uiState.setWorkflowPanelSize(workflowPanelSize === "wide" ? "normal" : "wide")}>{t("activity.widen")}</button>
      <button type="button" aria-pressed={workflowPanelSize === "maximized"} data-testid="workflow-maximize"
        onClick={() => uiState.setWorkflowPanelSize(workflowPanelSize === "maximized" ? "normal" : "maximized")}>{t("activity.maximize")}</button>
    </nav>
    <div className={css.body}>
      {threadId === null ? <p className={css.empty}>{t("activity.selectThread")}</p> : <>
        <ActivityPanel key={threadId} threadId={threadId} id="workflow-activity" view={view} docked />
        <WorkflowActivity key={`log:${threadId}`} threadId={threadId} />
      </>}
    </div>
  </aside>;
}
