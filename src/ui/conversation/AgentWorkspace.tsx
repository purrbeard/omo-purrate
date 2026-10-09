import { useContext, useEffect, useMemo, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { HistoricalTask, TaskWork } from "../../../shared/ipc";
import type { LiveTask } from "../../../shared/protocol";
import { useT } from "../../i18n";
import { selectAgentChildren, selectMainThreadId } from "../../state";
import { StoreContext, useActions, useAppSelector } from "../app-context";
import { uiState } from "../ui-state";
import { threadTitle } from "./format";
import type { ConversationTurn } from "../../state";
import { TurnView } from "./TurnView";
import { useTaskWork } from "./use-task-work";
import { useStickToBottom } from "./use-stick-to-bottom";
import css from "./AgentWorkspace.module.css";

type Task = LiveTask | HistoricalTask;
type WorkspaceState = { selected: string | null; closed: string[]; drafts: Record<string, string> };
const EMPTY: WorkspaceState = { selected: null, closed: [], drafts: {} };
const sessions = new Map<string, WorkspaceState>();
const STORAGE_KEY = "omo-ui.agent-workspace.v1";

function restore(parentId: string): WorkspaceState {
  const cached = sessions.get(parentId);
  if (cached !== undefined) return cached;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return EMPTY;
  let stored: unknown;
  try { stored = JSON.parse(raw); } catch { return EMPTY; }
  if (typeof stored !== "object" || stored === null || !(parentId in stored)) return EMPTY;
  const entry: unknown = (stored as Record<string, unknown>)[parentId];
  if (typeof entry !== "object" || entry === null || !("selected" in entry) || !("closed" in entry) || !("drafts" in entry)
    || (entry.selected !== null && typeof entry.selected !== "string") || !Array.isArray(entry.closed) || !entry.closed.every(id => typeof id === "string")
    || typeof entry.drafts !== "object" || entry.drafts === null || !Object.values(entry.drafts).every(text => typeof text === "string")) return EMPTY;
  return { selected: entry.selected, closed: entry.closed, drafts: entry.drafts as Record<string, string> };
}

function historyTurns(work: TaskWork | undefined): ConversationTurn[] {
  return work?.history?.turns.map(turn => ({
    id: turn.id, status: turn.status, error: turn.error,
    startedAtMs: turn.startedAt, completedAtMs: turn.completedAt, origin: "history",
    items: turn.items.map(item => ({ item, streaming: false, startedAtMs: null, completedAtMs: null })),
  })) ?? [];
}

export function AgentWorkspace({ placement }: { placement: "docked" | "overlay" }) {
  const parentId = useAppSelector(selectMainThreadId);
  return parentId === null ? null : <Workspace key={parentId} parentId={parentId} placement={placement} />;
}

function Workspace({ parentId, placement }: { parentId: string; placement: "docked" | "overlay" }) {
  const t = useT();
  const live = useAppSelector(state => state.conversations[parentId]?.live);
  const cwd = useAppSelector(state => state.threads[parentId]?.cwd ?? null);
  const loadError = useTaskWork(parentId);
  const actions = useActions();
  const store = useContext(StoreContext);
  const threadLinks = useAppSelector(state => state.threadLinks);
  const threads = useAppSelector(state => state.threads);
  const activeThreadId = useAppSelector(state => state.activeThreadId);
  // Subscribes to the two slices the selector reads rather than to every state change (each streamed token).
  const agentChildren = useMemo(() => { const snapshot = store?.getState(); return snapshot === undefined ? [] : selectAgentChildren(snapshot, parentId); }, [store, parentId, threadLinks, threads]);
  const [state, setState] = useState<WorkspaceState>(() => restore(parentId));
  const scroll = useStickToBottom();
  // Native holds a message to a finished agent open until that agent has answered, so the wait is tracked per agent.
  const [sending, setSending] = useState<readonly string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    sessions.set(parentId, state);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    let stored: unknown = {};
    if (raw !== null) { try { stored = JSON.parse(raw); } catch { stored = {}; } }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...(typeof stored === "object" && stored !== null ? stored : {}), [parentId]: state }));
  }, [parentId, state]);
  const tasks = useMemo(() => {
    const roster = new Map<string, Task>();
    for (const task of live?.historicalTasks ?? []) roster.set(task.task_id, task);
    for (const task of Object.values(live?.tasks ?? {})) roster.set(task.task_id, task);
    for (const work of live?.taskWork ?? []) roster.set(work.task.task_id, work.task);
    return [...roster.values()];
  }, [live?.historicalTasks, live?.tasks, live?.taskWork]);
  const open = tasks.filter(task => !state.closed.includes(task.task_id));
  // Native child sessions linked to this parent without a task record have no task transcript; they open in the main column.
  const taskSessions = new Set(tasks.flatMap(task => {
    const id = ("child_session_id" in task ? task.child_session_id : undefined) ?? threadLinks.find(link => link.taskId === task.task_id)?.childId;
    return id == null ? [] : [id];
  }));
  const linkedSessions = agentChildren.filter(child => !taskSessions.has(child.id));
  const selected = open.find(task => task.task_id === state.selected) ?? open[0];
  const work = live?.taskWork.find(item => item.task.task_id === selected?.task_id);
  const turns = useMemo(() => historyTurns(work), [work]);
  const draft = selected === undefined ? "" : state.drafts[selected.task_id] ?? "";
  const selectedId = selected?.task_id;
  useEffect(() => {
    if (selectedId !== undefined) document.getElementById(`agent-tab-${selectedId}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedId]);
  const canSend = selected !== undefined && !["cancelled", "killed", "lost"].includes(selected.status);
  const select = (taskId: string) => setState(value => ({ ...value, selected: taskId }));
  const close = (taskId: string) => setState(value => ({ ...value, selected: value.selected === taskId ? null : value.selected, closed: [...value.closed, taskId] }));
  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (selected === undefined || !canSend || sending.includes(selected.task_id) || !draft.trim()) return;
    const id = selected.task_id;
    setSending(value => [...value, id]);
    setErrors(value => ({ ...value, [id]: "" }));
    try {
      await window.omo.sendTaskMessage(parentId, id, draft);
      window.dispatchEvent(new CustomEvent("omo-ui:task-message", { detail: parentId }));
      setState(value => ({ ...value, drafts: { ...value.drafts, [id]: value.drafts[id] === draft ? "" : value.drafts[id] ?? "" } }));
    } catch (cause) {
      setErrors(value => ({ ...value, [id]: cause instanceof Error ? cause.message : String(cause) }));
    } finally { setSending(value => value.filter(entry => entry !== id)); }
  };
  const tabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = open.findIndex(task => task.task_id === selected?.task_id);
    const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const next = offset !== 0 ? open[(index + offset + open.length) % open.length]
      : event.key === "Home" ? open[0] : event.key === "End" ? open.at(-1) : undefined;
    if (next === undefined) return;
    event.preventDefault(); select(next.task_id);
    document.getElementById(`agent-tab-${next.task_id}`)?.focus();
  };
  return <section className={css.root} data-testid="agent-workspace" data-parent-id={parentId} data-placement={placement}>
    <div className={css.tabs} role="tablist" aria-label={t("activity.agents")} onKeyDown={tabKeys}>
      {open.map(task => <div key={task.task_id} className={css.tabWrap}>
        <button id={`agent-tab-${task.task_id}`} type="button" role="tab" className={css.tab}
          aria-selected={task.task_id === selected?.task_id} aria-controls="agent-chat-panel" tabIndex={task.task_id === selected?.task_id ? 0 : -1}
          data-testid="agent-chat-tab" data-task-id={task.task_id} data-status={task.status} onClick={() => select(task.task_id)}>
          <span className={css.dot} data-status={task.status} />{task.name ?? task.agent_type ?? task.category ?? task.task_id}
        </button>
        <button type="button" className={css.close} aria-label={`${task.name ?? task.task_id} · ${t("activity.closeAgents")}`} onClick={() => close(task.task_id)}>×</button>
      </div>)}
      {state.closed.length > 0 && <button className={css.reopen} type="button" onClick={() => setState(value => ({ ...value, closed: [] }))}>+ {t("activity.agents")}</button>}
    </div>
    {linkedSessions.length > 0 && <div className={css.sessions}>
      {linkedSessions.map(child => <button key={child.id} type="button" className={css.session} data-testid="agent-row" data-agent-thread-id={child.id}
        aria-pressed={activeThreadId === child.id} onClick={() => { void actions.openThread(child.id); if (placement === "overlay") uiState.setAgentPanelOpen(false); }}>
        {threadTitle(child, t("shell.newSession"))}<span>{t("activity.agentOpenConversation")}</span>
      </button>)}
    </div>}
    {loadError !== null && <p className={css.error} role="alert">{loadError}</p>}
    {selected === undefined ? (linkedSessions.length === 0 && <p className={css.empty}>{t("activity.agentEmpty")}</p>) : <>
      <div className={css.meta}><span>{selected.task_summary ?? selected.task_id}</span><span>{selected.status}</span></div>
      <div ref={scroll.scrollRef} id="agent-chat-panel" role="tabpanel" aria-labelledby={`agent-tab-${selected.task_id}`} className={css.transcript} data-testid="agent-chat-history">
        <div ref={scroll.contentRef}>
        {turns.map(turn => <TurnView key={turn.id} turn={turn} cwd={cwd} />)}
        {turns.length === 0 && <p className={css.empty}>{selected.final_response ?? work?.activity ?? t("activity.agentNoRecords")}</p>}
        </div>
      </div>
      <form className={css.composer} onSubmit={event => void send(event)} data-testid="agent-chat-composer">
        <textarea aria-label={t("activity.agentMessage")} placeholder={t("activity.agentMessage")} value={draft}
          onChange={event => { const text = event.target.value; setState(value => ({ ...value, drafts: { ...value.drafts, [selected.task_id]: text } })); }}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        <div className={css.footer}><span>{"model" in selected ? selected.model : ""}</span>
          <button type="submit" disabled={!canSend || !draft.trim() || sending.includes(selected.task_id)}>{sending.includes(selected.task_id) ? t("activity.agentSending") : t("activity.agentSend")}</button>
        </div>
        {errors[selected.task_id] && <p className={css.error} role="alert">{errors[selected.task_id]}</p>}
      </form>
    </>}
  </section>;
}
