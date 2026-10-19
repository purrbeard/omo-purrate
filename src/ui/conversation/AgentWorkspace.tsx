import { useContext, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
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
import { cancelChildTask } from "../../state/task-control";
import { useStickToBottom } from "./use-stick-to-bottom";
import clsx from "clsx";
import { CircleAlert } from "lucide-react";
import { Button, focusRing } from "../kit";
import { userErrorText } from "./user-error";
import { AgentTabStrip } from "./AgentTabStrip";

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

const OPEN_TAB_EVENT = "omo-ui:agent-tab";

/** Selects `taskId` in the agent workspace of `parentId`, reopening a closed tab; a workspace mounted later starts on it. */
export function openAgentTab(parentId: string, taskId: string): void {
  const current = restore(parentId);
  sessions.set(parentId, { ...current, selected: taskId, closed: current.closed.filter(id => id !== taskId) });
  window.dispatchEvent(new CustomEvent(OPEN_TAB_EVENT, { detail: { parentId, taskId } }));
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
  useEffect(() => {
    const opened = (event: Event): void => {
      if (!(event instanceof CustomEvent) || event.detail?.parentId !== parentId || typeof event.detail.taskId !== "string") return;
      const taskId: string = event.detail.taskId;
      setState(value => ({ ...value, selected: taskId, closed: value.closed.filter(id => id !== taskId) }));
    };
    window.addEventListener(OPEN_TAB_EVENT, opened);
    return () => window.removeEventListener(OPEN_TAB_EVENT, opened);
  }, [parentId]);
  // Native holds a message to a finished agent open until that agent has answered, so the wait is tracked per agent.
  const [sending, setSending] = useState<readonly string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stopping, setStopping] = useState<readonly string[]>([]);
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
  const canSend = selected !== undefined && !["cancelled", "killed", "lost"].includes(selected.status);
  const select = (taskId: string) => setState(value => ({ ...value, selected: taskId, closed: value.closed.filter(id => id !== taskId) }));
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
      setErrors(value => ({ ...value, [id]: userErrorText(cause, t("conversation.error.requestFailed")).text }));
    } finally { setSending(value => value.filter(entry => entry !== id)); }
  };
  const stop = async (taskId: string): Promise<void> => {
    setStopping(value => [...value, taskId]);
    setErrors(value => ({ ...value, [taskId]: "" }));
    try { await cancelChildTask(parentId, taskId); }
    catch (cause) { setErrors(value => ({ ...value, [taskId]: userErrorText(cause, t("conversation.error.requestFailed")).text })); }
    finally { setStopping(value => value.filter(entry => entry !== taskId)); }
  };
  return <section className={"flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-lg border border-solid border-border bg-background"} data-testid="agent-workspace" data-parent-id={parentId} data-placement={placement}>
    <AgentTabStrip open={open} all={tasks} selectedId={selected?.task_id} closedCount={state.closed.length} live={live?.freshness === "live"}
      onSelect={select} onClose={close} onReopen={() => setState(value => ({ ...value, closed: [] }))} />
    {linkedSessions.length > 0 && <div className={"flex shrink-0 flex-col gap-1.5 border-0 border-b border-solid border-border px-3 py-2.5"}>
      {linkedSessions.map(child => <button key={child.id} type="button" className={clsx("m-0 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-solid border-border bg-transparent px-2.5 py-2 text-left text-[13px] text-foreground [font-family:inherit] hover:bg-accent aria-pressed:bg-accent [&>span]:shrink-0 [&>span]:text-[11px] [&>span]:text-muted-foreground", focusRing)} data-testid="agent-row" data-agent-thread-id={child.id}
        aria-pressed={activeThreadId === child.id} onClick={() => { void actions.openThread(child.id); if (placement === "overlay") uiState.setAgentPanelOpen(false); }}>
        {threadTitle(child, t("shell.newSession"))}<span>{t("activity.agentOpenConversation")}</span>
      </button>)}
    </div>}
    {loadError !== null && <p className={"mx-4 my-2 flex items-start gap-1.5 text-xs [overflow-wrap:anywhere] text-destructive-foreground"} role="alert"><CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /><span title={loadError}>{userErrorText(loadError, t("conversation.error.requestFailed")).text}</span></p>}
    {selected === undefined ? (linkedSessions.length === 0 && <p className={"m-0 p-4 text-[13px] [overflow-wrap:anywhere] whitespace-pre-wrap text-muted-foreground"}>{t("activity.agentEmpty")}</p>) : <>
      <div className={"flex justify-between gap-3 px-4 py-3 text-xs text-muted-foreground [&>span:first-child]:truncate"} data-task-id={selected.task_id}><span>{selected.task_summary ?? selected.task_id}</span><span>{selected.status}</span>
        {(selected.status === "running" || selected.status === "queued") && <button type="button" className={clsx("m-0 shrink-0 cursor-pointer rounded-md border border-solid border-border bg-background px-2.5 py-0.5 text-xs text-foreground [font-family:inherit] hover:bg-accent disabled:cursor-default disabled:opacity-50", focusRing)} data-testid="agent-stop"
          aria-label={t("activity.stopAgent")} disabled={stopping.includes(selected.task_id)} onClick={() => void stop(selected.task_id)}>{t("activity.stop")}</button>}</div>
      <div ref={scroll.scrollRef} id="agent-chat-panel" role="tabpanel" aria-labelledby={`agent-tab-${selected.task_id}`} className={"min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-3"} data-testid="agent-chat-history">
        <div ref={scroll.contentRef}>
        {turns.map(turn => <TurnView key={turn.id} turn={turn} cwd={cwd} />)}
        {turns.length === 0 && <p className={"m-0 p-4 text-[13px] [overflow-wrap:anywhere] whitespace-pre-wrap text-muted-foreground"}>{selected.final_response ?? work?.activity ?? t("activity.agentNoRecords")}</p>}
        </div>
      </div>
      <form className={"mx-4 mt-3 mb-4 rounded-2xl border border-solid border-border bg-composer p-3 [&_textarea]:box-border [&_textarea]:max-h-40 [&_textarea]:min-h-[62px] [&_textarea]:w-full [&_textarea]:resize-y [&_textarea]:border-0 [&_textarea]:bg-transparent [&_textarea]:text-[13px] [&_textarea]:text-composer-foreground [&_textarea]:[font-family:inherit]"} onSubmit={event => void send(event)} data-testid="agent-chat-composer">
        <textarea aria-label={t("activity.agentMessage")} placeholder={t("activity.agentMessage")} value={draft}
          onChange={event => { const text = event.target.value; setState(value => ({ ...value, drafts: { ...value.drafts, [selected.task_id]: text } })); }}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        <div className={"flex items-center justify-between gap-3 [&>span]:truncate [&>span]:text-[11px] [&>span]:text-muted-foreground"}><span>{"model" in selected ? selected.model : ""}</span>
          <Button type="submit" variant="primary" size="sm" disabled={!canSend || !draft.trim() || sending.includes(selected.task_id)}>{sending.includes(selected.task_id) ? t("activity.agentSending") : t("activity.agentSend")}</Button>
        </div>
        {errors[selected.task_id] && <p className={"mx-4 my-2 flex items-start gap-1.5 text-xs [overflow-wrap:anywhere] text-destructive-foreground"} role="alert"><CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />{errors[selected.task_id]}</p>}
      </form>
    </>}
  </section>;
}
