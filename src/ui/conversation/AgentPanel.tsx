import { useEffect, useId, useRef, useState } from "react";
import type { TaskWork } from "../../../shared/ipc";
import { selectAgentChildren, selectMainThreadId, selectTasks, selectThreadLiveState } from "../../state";
import { useActions, useAppSelector } from "../app-context";
import { useT } from "../../i18n";
import { uiState } from "../ui-state";
import { threadTitle } from "./format";
import clsx from "clsx";
import { X } from "lucide-react";
import { Button, IconButton, focusRing } from "../kit";

const agentRow = clsx("m-0 flex w-full cursor-pointer flex-col gap-1.5 rounded-md border border-solid border-border bg-transparent p-2.5 text-start text-xs text-inherit [font-family:inherit] hover:bg-accent aria-pressed:bg-accent", focusRing);
const agentName = "flex justify-between gap-2 font-semibold [overflow-wrap:anywhere]";
const agentStatus = "shrink-0 font-normal text-muted-foreground";

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
  return <aside ref={panelRef} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-solid border-border bg-background text-xs text-foreground data-[placement=overlay]:shadow-lg" data-placement={placement} data-testid="agent-panel"
    role={placement === "overlay" ? "dialog" : "complementary"} aria-modal={placement === "overlay" ? true : undefined} aria-labelledby={headingId} tabIndex={-1}>
    <header className="flex items-center gap-2 border-0 border-b border-solid border-border p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1 [&>span]:truncate [&>span]:text-muted-foreground [&>strong]:text-[13px]"><strong id={headingId}>{t("activity.agents")}</strong><span>{threadTitle(main, t("shell.newSession"))}</span></div>
      <IconButton icon={<X aria-hidden />} label={t("activity.close")} data-testid="agent-panel-close" onClick={() => uiState.setAgentPanelOpen(false)} />
    </header>
    <div className="min-h-0 min-w-0 flex-1 overflow-auto p-3">
      {mainId !== null && activeId !== mainId && <Button variant="secondary" size="sm" className="mb-3" data-testid="agent-return-main" onClick={() => void actions.openThread(mainId)}>{t("activity.returnMain")}</Button>}
      <p className="m-0 my-2 leading-normal text-muted-foreground">{activeId !== mainId ? t("activity.agentConversationShown") : t("activity.agentSelectHint")}</p>
      {loadError !== null && <p role="alert">{loadError}</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {tasks.map(candidate => {
          const childId = ("child_session_id" in candidate ? candidate.child_session_id : undefined) ?? childOf(candidate.task_id);
          const child = children.find(thread => thread.id === childId);
          return <li key={candidate.task_id}><button type="button" className={agentRow} data-testid="agent-row" data-task-id={candidate.task_id}
            aria-pressed={selectedTask === candidate.task_id || (child !== undefined && activeId === child.id)} onClick={() => {
              setSelectedTask(candidate.task_id);
              if (child !== undefined) { void actions.openThread(child.id); if (placement === "overlay") uiState.setAgentPanelOpen(false); }
            }}>
            <span className={agentName}>{candidate.name ?? candidate.agent_type ?? candidate.category ?? candidate.task_id}<span className={agentStatus}>{candidate.status === "running" ? t("activity.task.running") : candidate.status === "completed" ? t("activity.task.completed") : candidate.status === "error" ? t("activity.task.error") : candidate.status === "queued" ? t("activity.task.queued") : candidate.status}</span></span>
            <span className="leading-normal [overflow-wrap:anywhere]">{candidate.task_summary ?? ("description" in candidate ? candidate.description : undefined) ?? candidate.task_id}</span>
            <span className="text-muted-foreground">{child === undefined ? t("activity.agentRecordedWork") : t("activity.agentOpenConversation")}</span>
          </button></li>;
        })}
        {children.filter(child => !linked.has(child.id)).map(child => <li key={child.id}><button type="button" className={agentRow} data-testid="agent-row" data-agent-thread-id={child.id}
          aria-pressed={activeId === child.id} onClick={() => { setSelectedTask(null); void actions.openThread(child.id); if (placement === "overlay") uiState.setAgentPanelOpen(false); }}>
          <span className={agentName}>{threadTitle(child, t("shell.newSession"))}<span className={agentStatus}>{child.status.type === "active" ? t("activity.task.running") : t("activity.agentSaved")}</span></span>
          <span className="leading-normal [overflow-wrap:anywhere]">{child.preview}</span><span className="text-muted-foreground">{t("activity.agentOpenConversation")}</span>
        </button></li>)}
        {workTasks.map(work => <li key={work.task.task_id}><button type="button" className={agentRow} data-testid="agent-row" aria-pressed={selectedTask === work.task.task_id} onClick={() => setSelectedTask(work.task.task_id)}>
          <span className={agentName}>{work.task.name ?? work.task.agent_type ?? work.task.task_id}<span className={agentStatus}>{work.task.status}</span></span>
          <span className="leading-normal [overflow-wrap:anywhere]">{work.task.task_summary}</span><span className="text-muted-foreground">{t("activity.agentRecordedWork")}</span>
        </button></li>)}
      </ul>
      {tasks.length === 0 && children.length === 0 && workTasks.length === 0 && <p className="m-0 my-2 leading-normal text-muted-foreground">{t("activity.agentEmpty")}</p>}
      {(task !== undefined || work !== undefined) && <section className="mt-4 border-0 border-t border-solid border-border pt-3 [overflow-wrap:anywhere] [&_h3]:m-0 [&_h3]:mb-2 [&_h3]:text-[13px] [&_pre]:leading-normal [&_pre]:whitespace-pre-wrap [&_pre]:[font:inherit]" data-testid="agent-records"><h3>{task?.task_summary ?? task?.name ?? work?.task.name ?? selectedTask}</h3>
        {(task?.final_response ?? work?.task.final_response) && <pre>{task?.final_response ?? work?.task.final_response}</pre>}{task?.error_message && <p role="alert">{task.error_message}</p>}
        {work?.todo && <ul>{work.todo.phases.flatMap(phase => phase.tasks).map((item, index) => <li key={index}>{item.status} · {item.content}</li>)}</ul>}
        {work?.activity && <details><summary>{t("activity.agentRecordedWork")}</summary><pre>{work.activity}</pre></details>}
        {!task?.final_response && !work?.task.final_response && work?.activity == null && <p className="m-0 my-2 leading-normal text-muted-foreground">{t("activity.agentNoRecords")}</p>}
      </section>}
    </div>
  </aside>;
}
