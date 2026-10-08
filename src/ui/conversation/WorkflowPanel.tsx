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
  const [view, setView] = useState<"list" | "graph" | "activity">("graph");
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (placement !== "overlay") return;
    const previous = document.activeElement;
    closeRef.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, [placement]);
  return <aside id="workflow-panel" ref={panelRef} className={css.panel} data-testid="workflow-panel" data-placement={placement} data-size={workflowPanelSize}
    role={placement === "overlay" ? "dialog" : "complementary"} aria-label={t("activity.workflow")}
    aria-modal={placement === "overlay" ? true : undefined} tabIndex={-1}
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); uiState.setWorkflowPanelOpen(false); }
      if (placement === "overlay" && event.key === "Tab") {
        const controls = [...(panelRef.current?.querySelectorAll<HTMLElement>('button, summary, [tabindex], input, select, textarea, a[href]') ?? [])].filter(control => {
          if (control.tabIndex < 0 || control.matches(":disabled") || control.closest("[hidden], [inert]") !== null || control.getClientRects().length === 0) return false;
          const visibility = getComputedStyle(control).visibility;
          if (visibility === "hidden" || visibility === "collapse") return false;
          for (let ancestor = control.parentElement; ancestor !== null && ancestor !== panelRef.current; ancestor = ancestor.parentElement) {
            if (ancestor instanceof HTMLDetailsElement && !ancestor.open && !ancestor.querySelector(":scope > summary")?.contains(control)) return false;
          }
          return true;
        });
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (first === undefined) { event.preventDefault(); panelRef.current?.focus(); return; }
        if (!controls.includes(document.activeElement as HTMLElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); return; }
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
      <div role="tablist" aria-label={t("activity.view")}>
      <button id="workflow-tab-graph" type="button" role="tab" aria-selected={view === "graph"} aria-controls="workflow-content" onClick={() => setView("graph")} data-testid="workflow-graph-view">{t("activity.graph")}</button>
      <button id="workflow-tab-agents" type="button" role="tab" aria-selected={view === "list"} aria-controls="workflow-content" onClick={() => setView("list")} data-testid="workflow-list">{t("activity.agents")}</button>
      <button id="workflow-tab-log" type="button" role="tab" aria-selected={view === "activity"} aria-controls="workflow-log-content" onClick={() => setView("activity")} data-testid="workflow-log-view">{t("activity.log.title")}</button>
      </div>
      <span className={css.spacer} />
      <button type="button" aria-pressed={workflowPanelSize === "wide"} data-testid="workflow-widen"
        onClick={() => uiState.setWorkflowPanelSize(workflowPanelSize === "wide" ? "normal" : "wide")}>{t("activity.widen")}</button>
      <button type="button" aria-pressed={workflowPanelSize === "maximized"} data-testid="workflow-maximize"
        onClick={() => uiState.setWorkflowPanelSize(workflowPanelSize === "maximized" ? "normal" : "maximized")}>{t("activity.maximize")}</button>
    </nav>
    <div className={css.body}>
      {threadId === null ? <p className={css.empty}>{t("activity.selectThread")}</p> : <>
        {view !== "activity" && <div id="workflow-content" role="tabpanel" aria-labelledby={view === "graph" ? "workflow-tab-graph" : "workflow-tab-agents"}>
          <ActivityPanel key={threadId} threadId={threadId} id="workflow-activity" view={view} docked />
        </div>}
        <div id="workflow-log-content" role="tabpanel" aria-labelledby="workflow-tab-log" hidden={view !== "activity"}><WorkflowActivity key={`log:${threadId}`} threadId={threadId} /></div>
      </>}
    </div>
  </aside>;
}
