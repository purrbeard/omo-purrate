import { useEffect, useId, useRef, useState } from "react";
import type { TaskWork } from "../../../shared/ipc";
import { selectAgentChildren, selectMainThreadId, selectTasks, selectThreadLiveState } from "../../state";
import { useActions, useAppSelector } from "../app-context";
import { useT } from "../../i18n";
import { uiState } from "../ui-state";
import { threadTitle } from "./format";
import css from "./AgentPanel.module.css";

export function AgentPanel({ placement }: { placement: "docked" | "overlay" }) {
  const t = useT();
  const actions = useActions();
  const mainId = useAppSelector(selectMainThreadId);
  const main = useAppSelector(state => mainId === null ? null : state.threads[mainId] ?? null);
  const activeId = useAppSelector(state => state.activeThreadId);
  const state = useAppSelector(state => state);
  const children = selectAgentChildren(state, mainId);
  const tasks = useAppSelector(state => mainId === null ? [] : selectTasks(state, mainId));
  const live = useAppSelector(state => mainId === null ? null : selectThreadLiveState(state, mainId));
  const links = useAppSelector(state => state.threadLinks);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [recordedWork, setRecordedWork] = useState<TaskWork[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const headingId = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    panel?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { uiState.setAgentPanelOpen(false); event.preventDefault(); }
      if (event.key !== "Tab" || placement !== "overlay" || panel === null) return;
      const items = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]')];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    panel?.addEventListener("keydown", key);
    return () => { panel?.removeEventListener("keydown", key); if (previous?.isConnected) previous.focus(); };
  }, [placement]);
  useEffect(() => { setSelectedTask(null); }, [mainId]);
  useEffect(() => {
    let active = true;
    setRecordedWork([]);
    setLoadError(null);
    if (main !== null && mainId !== null) void window.omo.loadTaskWork(main.cwd, mainId).then(work => { if (active) setRecordedWork(work); }, error => { if (active) setLoadError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [main?.cwd, mainId]);
  const workTasks = recordedWork.filter(work => !tasks.some(task => task.task_id === work.task.task_id));
  const task = tasks.find(candidate => candidate.task_id === selectedTask);
  const work = live?.taskWork.find(candidate => candidate.task.task_id === selectedTask) ?? recordedWork.find(candidate => candidate.task.task_id === selectedTask);
  const childOf = (taskId: string): string | undefined => links.find(link => link.taskId === taskId)?.childId;
  const linked = new Set(tasks.flatMap(candidate => {
    const id = ("child_session_id" in candidate ? candidate.child_session_id : undefined) ?? childOf(candidate.task_id);
    return id === undefined ? [] : [id];
  }));
  return <aside ref={panelRef} className={css.panel} data-placement={placement} data-testid="agent-panel"
    role={placement === "overlay" ? "dialog" : "complementary"} aria-modal={placement === "overlay" ? true : undefined} aria-labelledby={headingId} tabIndex={-1}>
    <header className={css.header}>
      <div className={css.heading}><strong id={headingId}>{t("activity.agents")}</strong><span>{threadTitle(main, t("shell.newSession"))}</span></div>
      <button type="button" aria-label={t("activity.close")} data-testid="agent-panel-close" onClick={() => uiState.setAgentPanelOpen(false)}>×</button>
    </header>
    <div className={css.body}>
      {mainId !== null && activeId !== mainId && <button type="button" className={css.return} data-testid="agent-return-main" onClick={() => void actions.openThread(mainId)}>{t("activity.returnMain")}</button>}
      <p className={css.hint}>{activeId !== mainId ? t("activity.agentConversationShown") : t("activity.agentSelectHint")}</p>
      {loadError !== null && <p role="alert">{loadError}</p>}
      <ul className={css.list}>
        {tasks.map(candidate => {
          const childId = ("child_session_id" in candidate ? candidate.child_session_id : undefined) ?? childOf(candidate.task_id);
          const child = children.find(thread => thread.id === childId);
          return <li key={candidate.task_id}><button type="button" className={css.agent} data-testid="agent-row" data-task-id={candidate.task_id}
            aria-pressed={selectedTask === candidate.task_id || (child !== undefined && activeId === child.id)} onClick={() => {
              setSelectedTask(candidate.task_id);
              if (child !== undefined) { void actions.openThread(child.id); if (placement === "overlay") uiState.setAgentPanelOpen(false); }
            }}>
            <span className={css.name}>{candidate.name ?? candidate.agent_type ?? candidate.category ?? candidate.task_id}<span className={css.status}>{candidate.status === "running" ? t("activity.task.running") : candidate.status === "completed" ? t("activity.task.completed") : candidate.status === "error" ? t("activity.task.error") : candidate.status === "queued" ? t("activity.task.queued") : candidate.status}</span></span>
            <span className={css.task}>{candidate.task_summary ?? ("description" in candidate ? candidate.description : undefined) ?? candidate.task_id}</span>
            <span className={css.meta}>{child === undefined ? t("activity.agentRecordedWork") : t("activity.agentOpenConversation")}</span>
          </button></li>;
        })}
        {children.filter(child => !linked.has(child.id)).map(child => <li key={child.id}><button type="button" className={css.agent} data-testid="agent-row" data-agent-thread-id={child.id}
          aria-pressed={activeId === child.id} onClick={() => { setSelectedTask(null); void actions.openThread(child.id); if (placement === "overlay") uiState.setAgentPanelOpen(false); }}>
          <span className={css.name}>{threadTitle(child, t("shell.newSession"))}<span className={css.status}>{child.status.type === "active" ? t("activity.task.running") : t("activity.agentSaved")}</span></span>
          <span className={css.task}>{child.preview}</span><span className={css.meta}>{t("activity.agentOpenConversation")}</span>
        </button></li>)}
        {workTasks.map(work => <li key={work.task.task_id}><button type="button" className={css.agent} data-testid="agent-row" aria-pressed={selectedTask === work.task.task_id} onClick={() => setSelectedTask(work.task.task_id)}>
          <span className={css.name}>{work.task.name ?? work.task.agent_type ?? work.task.task_id}<span className={css.status}>{work.task.status}</span></span>
          <span className={css.task}>{work.task.task_summary}</span><span className={css.meta}>{t("activity.agentRecordedWork")}</span>
        </button></li>)}
      </ul>
      {tasks.length === 0 && children.length === 0 && workTasks.length === 0 && <p className={css.hint}>{t("activity.agentEmpty")}</p>}
      {(task !== undefined || work !== undefined) && <section className={css.detail} data-testid="agent-records"><h3>{task?.task_summary ?? task?.name ?? work?.task.name ?? selectedTask}</h3>
        {(task?.final_response ?? work?.task.final_response) && <pre>{task?.final_response ?? work?.task.final_response}</pre>}{task?.error_message && <p role="alert">{task.error_message}</p>}
        {work?.todo && <ul>{work.todo.phases.flatMap(phase => phase.tasks).map((item, index) => <li key={index}>{item.status} · {item.content}</li>)}</ul>}
        {work?.activity && <details><summary>{t("activity.agentRecordedWork")}</summary><pre>{work.activity}</pre></details>}
        {!task?.final_response && !work?.task.final_response && work?.activity == null && <p className={css.hint}>{t("activity.agentNoRecords")}</p>}
      </section>}
    </div>
  </aside>;
}
