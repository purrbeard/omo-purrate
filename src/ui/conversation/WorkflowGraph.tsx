import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Maximize } from "lucide-react";
import type { DagRun } from "../../../shared/protocol";
import { useT, type MessageKey, type Translate } from "../../i18n";
import {
  isHistoricalTask, isSuspended, knownNodeState, knownTaskStatus, nodeDot, nodeElapsedMs, taskDot, taskElapsedMs, taskTitle,
  type ActivityTask, type NodeState, type StateDotState, type TaskStatus,
} from "./activity-model";
import { formatDuration } from "./format";
import {
  CANVAS_PADDING, CARD_HEIGHT, CARD_WIDTH, COLUMN_LABEL_HEIGHT, GRAPH_TESTID, MAX_SCALE, MIN_SCALE, READABLE_SCALE,
  fitScale, layoutAgentTree, layoutWorkflowGraph, neighborNode, zoomIn, zoomOut, type AgentTreeNode, type GraphDirection, type GraphLayout,
} from "./workflow-graph";
import { Button, StateDot } from "../kit";

/** Same table as ActivityPanel's private one: the status word next to every status color. */
const NODE_LABELS = {
  pending: "activity.node.pending", blocked: "activity.node.blocked", scheduled: "activity.node.scheduled",
  running: "activity.node.running", completed: "activity.node.completed", failed: "activity.node.failed",
  cancelled: "activity.node.cancelled", skipped: "activity.node.skipped",
} as const satisfies Record<NodeState, MessageKey>;
const TASK_LABELS = {
  pending: "activity.task.pending", running: "activity.task.running", completed: "activity.task.completed",
  error: "activity.task.error", cancelled: "activity.task.cancelled", interrupted: "activity.task.interrupted", lost: "activity.task.lost",
} as const satisfies Record<TaskStatus, MessageKey>;

/** Classes per graph part; geometry arrives as inline sizes from workflow-graph.ts. */
const G = {
  root: "flex min-w-0 flex-col gap-2 pt-2 pb-3",
  toolbar: "flex flex-none items-center gap-1 px-3",
  zoomButton: "h-7! w-7! px-0! text-sm!",
  scale: "min-w-11 text-center text-[11px] text-muted-foreground tabular-nums",
  hint: "ml-auto min-w-0 truncate text-[11px] text-muted-foreground",
  viewport: "relative max-h-[min(72vh,960px)] min-w-0 cursor-grab overflow-auto overscroll-contain data-panning:cursor-grabbing data-panning:select-none",
  stage: "relative overflow-hidden",
  canvas: "absolute top-0 left-0 origin-top-left bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-size-[16px_16px]",
  edges: "pointer-events-none absolute inset-0 overflow-visible [&_g]:text-border [&_g]:transition-opacity [&_g]:duration-[120ms] [&_g[data-dimmed]]:opacity-20 [&_g[data-state=done]]:text-success [&_g[data-state=ongoing]]:text-ring [&_g[data-state=error]]:text-destructive-foreground [&_g[data-state=warning]]:text-warning motion-reduce:[&_g]:transition-none",
  edge: "fill-none stroke-current [stroke-linecap:round] [stroke-width:1.5]",
  arrow: "fill-current stroke-none",
  lane: "absolute box-border border-0 border-l border-dashed border-border/70 first-of-type:border-l-0",
  laneLabel: "absolute box-border truncate rounded-sm px-1 text-center text-[10px] leading-4 font-medium tracking-wide text-muted-foreground uppercase tabular-nums",
  node: "group/node absolute m-0 box-border flex cursor-pointer flex-col gap-0.5 overflow-hidden rounded-[var(--dsw-radius-sm)] border border-solid border-border bg-card px-3 py-[7px] text-left [font-family:inherit] text-xs leading-[18px] text-foreground shadow-[inset_3px_0_0_var(--border)] transition-[background-color,border-color,opacity] duration-[120ms] hover:bg-accent active:bg-secondary motion-reduce:transition-none data-[dot=done]:shadow-[inset_3px_0_0_var(--success)] data-[dot=error]:shadow-[inset_3px_0_0_var(--destructive-foreground)] data-[dot=ongoing]:shadow-[inset_3px_0_0_var(--ring)] data-[dot=warning]:shadow-[inset_3px_0_0_var(--warning)] data-dimmed:opacity-35 data-focused:border-ring outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
  nodeHead: "flex min-w-0 items-center gap-1.5",
  nodeName: "min-w-0 truncate font-medium",
  nodeRoute: "min-w-0 truncate text-[11px] leading-4 text-muted-foreground",
  nodeMeta: "flex justify-between gap-2 text-[11px] leading-4 text-muted-foreground",
  nodeStatus: "min-w-0 truncate group-data-[dot=error]/node:text-destructive-foreground",
  nodeElapsed: "flex-none tabular-nums",
  nodeDeps: "min-w-0 truncate text-[11px] leading-4 text-muted-foreground",
  unresolved: "text-warning",
  empty: "m-0 px-3 py-4 text-muted-foreground",
} as const;

const ARROW_DIRECTIONS: Record<string, GraphDirection> = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
};

function nodeLabel(state: string, t: Translate): string {
  const known = knownNodeState(state);
  return known === null ? state : t(NODE_LABELS[known]);
}

function taskLabel(status: string, t: Translate): string {
  const known = knownTaskStatus(status);
  return known === null ? status : t(TASK_LABELS[known]);
}

/** Agent and short model of a task, as one card line. */
function taskRouteLine(task: ActivityTask | undefined): string | null {
  if (task === undefined) return null;
  const parts = [task.name?.trim(), task.category ?? task.agent_type, task.model?.split("/").at(-1)].filter((part): part is string => !!part);
  return parts.length === 0 ? null : [...new Set(parts)].join(" · ");
}

function taskElapsed(task: ActivityTask, now: number, live: boolean): number | null {
  const executing = live && !isHistoricalTask(task) && !isSuspended(task);
  return taskElapsedMs(task, now, executing) ?? (isHistoricalTask(task) ? null : task.run_stats?.runtime_ms ?? null);
}

/** What one card shows; the canvas owns geometry, focus and events. */
interface GraphCard {
  title: string;
  route: string | null;
  dot: StateDotState;
  state: string;
  statusText: string;
  elapsed: number | null;
  upstream: string[];
  unresolved: string[];
  tooltip: string;
  taskId?: string | undefined;
}

/** Every node the focused one depends on or feeds, transitively; the rest dims. */
function related<T>(layout: GraphLayout<T>, id: string): Set<string> {
  const keep = new Set([id]);
  for (const key of ["upstream", "downstream"] as const) {
    const queue = [id];
    while (queue.length > 0) {
      for (const neighbor of layout.byId.get(queue.pop()!)?.[key] ?? []) {
        if (keep.has(neighbor)) continue;
        keep.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return keep;
}

/**
 * Lane columns of status cards joined by curved edges. The viewport scrolls and pans (drag the background),
 * fits the width by default, and focusing or hovering a card dims every card it neither depends on nor feeds.
 */
function GraphCanvas<T extends { id: string }>({ layout, cards, laneLabel, onActivate, testId, nodeTestId, runId, hint }: {
  layout: GraphLayout<T>; cards: ReadonlyMap<string, GraphCard>; laneLabel: (index: number | null) => string;
  onActivate: (nodeId: string) => void; testId: string; nodeTestId: string; runId?: string | undefined; hint?: string | undefined;
}) {
  const t = useT();
  const viewportRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const [viewportWidth, setViewportWidth] = useState(0);
  /** "auto" fits down to a readable size and scrolls past it; "fit" shows the whole canvas; a number is a zoom the user chose. */
  const [zoom, setZoom] = useState<"auto" | "fit" | number>("auto");
  const [focused, setFocused] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const pan = useRef<{ pointer: number; x: number; y: number; left: number; top: number } | null>(null);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const measure = (): void => setViewportWidth(viewport.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  const fit = fitScale(layout, { width: viewportWidth });
  const scale = zoom === "fit" ? fit : zoom === "auto" ? Math.max(fit, Math.min(1, READABLE_SCALE)) : zoom;
  const fitted = zoom === "fit" || (zoom === "auto" && scale === fit);
  const setManualScale = (value: number | null): void => setZoom(value === null ? "fit" : value);
  const keep = useMemo(() => (focused === null || !layout.byId.has(focused) ? null : related(layout, focused)), [layout, focused]);
  const focusNode = useCallback((id: string | null): void => {
    if (id !== null) cardRefs.current.get(id)?.focus();
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const direction = ARROW_DIRECTIONS[event.key];
    const nodeId = event.target instanceof HTMLElement ? event.target.dataset["nodeId"] : undefined;
    if (direction !== undefined && nodeId !== undefined) {
      event.preventDefault();
      focusNode(neighborNode(layout, nodeId, direction));
      return;
    }
    if (event.key === "+" || event.key === "=") setManualScale(zoomIn(scale));
    else if (event.key === "-" || event.key === "_") setManualScale(zoomOut(scale));
    else if (event.key === "0") setManualScale(null);
    else return;
    event.preventDefault();
  };
  const startPan = (event: PointerEvent<HTMLDivElement>): void => {
    const viewport = viewportRef.current;
    if (viewport === null || event.button !== 0 || (event.target instanceof Element && event.target.closest("button") !== null)) return;
    pan.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
    setPanning(true);
  };
  const movePan = (event: PointerEvent<HTMLDivElement>): void => {
    const viewport = viewportRef.current;
    const start = pan.current;
    if (viewport === null || start === null || start.pointer !== event.pointerId) return;
    viewport.scrollLeft = start.left - (event.clientX - start.x);
    viewport.scrollTop = start.top - (event.clientY - start.y);
  };
  const endPan = (event: PointerEvent<HTMLDivElement>): void => {
    if (pan.current?.pointer !== event.pointerId) return;
    pan.current = null;
    setPanning(false);
  };
  return (
    <section className={G.root} data-testid={testId} data-run-id={runId} data-lanes={layout.lanes} data-fit={fitted ? "" : undefined}
      aria-label={t("activity.graph")} onKeyDown={onKeyDown}>
      <div className={G.toolbar} role="toolbar" aria-label={t("activity.graph.zoom")}>
        <Button size="sm" variant="outline" className={G.zoomButton} aria-label={t("activity.graph.zoomOut")} disabled={scale <= MIN_SCALE}
          onClick={() => setManualScale(zoomOut(scale))}>−</Button>
        <output className={G.scale} aria-label={t("activity.graph.zoom")}>{Math.round(scale * 100)}%</output>
        <Button size="sm" variant="outline" className={G.zoomButton} aria-label={t("activity.graph.zoomIn")} disabled={scale >= MAX_SCALE}
          onClick={() => setManualScale(zoomIn(scale))}>+</Button>
        <Button size="sm" variant="outline" className="h-7! px-2.5! [&_svg]:size-3.5!" icon={<Maximize aria-hidden />} aria-pressed={fitted}
          onClick={() => setManualScale(null)}>{t("activity.graph.fit")}</Button>
        {hint !== undefined && <span className={G.hint} title={hint}>{hint}</span>}
      </div>
      <div ref={viewportRef} className={G.viewport} data-panning={panning || undefined} data-testid="workflow-graph-viewport"
        onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
        {layout.nodes.length === 0 ? <p className={G.empty}>{t("activity.run.empty")}</p> : (
          <div className={G.stage} data-graph-stage style={{ width: layout.width * scale, height: layout.height * scale }}>
            <div className={G.canvas} style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
              {layout.columns.map((column) => (
                <div key={`lane:${column.index ?? "rest"}`} className={G.lane} data-testid="workflow-graph-lane" data-lane={column.index ?? undefined}
                  style={{ left: column.x - (column.x === CANVAS_PADDING ? 0 : 24), top: 0, width: 0, height: layout.height }} aria-hidden="true" />
              ))}
              <svg className={G.edges} width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
                {layout.edges.map((edge) => (
                  <g key={edge.id} data-state={cards.get(edge.from)?.dot ?? "idle"} data-dimmed={keep !== null && !(keep.has(edge.from) && keep.has(edge.to)) ? "" : undefined}
                    data-edge-from={edge.from} data-edge-to={edge.to}>
                    <path className={G.edge} d={edge.path} />
                    <path className={G.arrow} d={edge.arrow} />
                  </g>
                ))}
              </svg>
              {layout.columns.map((column) => (
                <span key={column.index ?? "rest"} className={G.laneLabel} data-testid="workflow-graph-lane-label" title={laneLabel(column.index)}
                  style={{ left: column.x, top: CANVAS_PADDING, width: CARD_WIDTH, height: COLUMN_LABEL_HEIGHT }}>
                  {laneLabel(column.index)}
                </span>
              ))}
              {layout.nodes.map(({ node, x, y, column, row }) => {
                const id = node.id;
                const card = cards.get(id);
                if (card === undefined) return null;
                const dependsLine = card.upstream.length + card.unresolved.length === 0 ? null : t("activity.depends", { nodes: [...card.upstream, ...card.unresolved].join(", ") });
                const unresolvedLine = card.unresolved.length === 0 ? null : t("activity.graph.unresolved", { nodes: card.unresolved.join(", ") });
                return (
                  <button key={id} type="button" className={G.node} data-testid={nodeTestId} data-node-id={id} data-task-id={card.taskId}
                    data-state={card.state} data-dot={card.dot} data-column={column} data-row={row}
                    data-dimmed={keep !== null && !keep.has(id) ? "" : undefined} data-focused={focused === id || undefined}
                    ref={(element) => { if (element === null) cardRefs.current.delete(id); else cardRefs.current.set(id, element); }}
                    style={{ left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT }}
                    title={[card.statusText, card.title, card.route, dependsLine, unresolvedLine, card.tooltip].filter(Boolean).join("\n")}
                    onFocus={() => setFocused(id)} onBlur={() => setFocused((current) => (current === id ? null : current))}
                    onMouseEnter={() => setFocused(id)} onMouseLeave={() => setFocused((current) => (current === id && document.activeElement !== cardRefs.current.get(id) ? null : current))}
                    onClick={() => onActivate(id)}>
                    <span className={G.nodeHead}>
                      <StateDot state={card.dot} size={10} />
                      <span className={G.nodeName}>{card.title}</span>
                    </span>
                    <span className={G.nodeRoute}>{card.route ?? "\u00a0"}</span>
                    <span className={G.nodeMeta}>
                      <span className={G.nodeStatus}>{card.statusText}</span>
                      <span className={G.nodeElapsed}>{card.elapsed === null ? "—" : formatDuration(card.elapsed, t)}</span>
                    </span>
                    {card.upstream.length + card.unresolved.length > 0 && (
                      <span className={G.nodeDeps}>
                        <span aria-hidden="true">← </span>
                        {card.upstream.join(" · ")}
                        {card.upstream.length > 0 && card.unresolved.length > 0 && " · "}
                        {card.unresolved.length > 0 && <span className={G.unresolved} title={unresolvedLine ?? undefined}>{card.unresolved.join(" · ")} ?</span>}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** A workflow run: one lane per wave (or dependency level when the waves are unusable), cards with the node's agent and model. */
export function WorkflowGraph({ run, live, now, tasks, onSelect }: {
  run: DagRun; live: boolean; now: number; tasks?: ReadonlyMap<string, ActivityTask>; onSelect: (nodeId: string) => void;
}) {
  const t = useT();
  const layout = useMemo(() => layoutWorkflowGraph(run), [run]);
  const cards = useMemo(() => new Map(layout.nodes.map(({ node, upstream, unresolved }): [string, GraphCard] => {
    const task = node.task_id === undefined ? undefined : tasks?.get(node.task_id);
    return [node.id, {
      title: node.label?.trim() || node.id, route: taskRouteLine(task), dot: nodeDot(node.state, live), state: node.state,
      statusText: nodeLabel(node.state, t), elapsed: nodeElapsedMs(node, now, live), upstream, unresolved,
      tooltip: [node.last_error?.message, node.prompt].filter(Boolean).join("\n"), taskId: node.task_id,
    }];
  })), [layout, tasks, live, now, t]);
  const laneLabel = (index: number | null): string => index === null ? t("activity.run.unscheduled")
    : layout.lanes === "waves" ? t("activity.run.wave", { index: index + 1 }) : t("activity.graph.level", { index: index + 1 });
  return <GraphCanvas layout={layout} cards={cards} laneLabel={laneLabel} onActivate={onSelect} testId={GRAPH_TESTID.graph} nodeTestId={GRAPH_TESTID.node} runId={run.run_id}
    hint={layout.lanes === "dependencies" && run.waves.length > 0 ? t("activity.graph.levelsHint") : undefined} />;
}

/** The root of the agent tree: the session that started the top-level agents. */
export interface AgentGraphRoot {
  id: string;
  title: string;
  running: boolean;
}

/** Without a workflow run: the parent-to-child agent tree, one lane per depth, so the graph is never empty while agents exist. */
export function AgentGraph({ root, trees, live, now, onOpen }: {
  root: AgentGraphRoot; trees: readonly AgentTreeNode<ActivityTask>[]; live: boolean; now: number; onOpen: (taskId: string) => void;
}) {
  const t = useT();
  const layout = useMemo(() => layoutAgentTree<ActivityTask | AgentGraphRoot>([{ id: root.id, item: root, children: [...trees] }]), [root, trees]);
  const cards = useMemo(() => new Map(layout.nodes.map(({ node, upstream }): [string, GraphCard] => {
    const item = node.item;
    if (!("task_id" in item)) {
      return [node.id, { title: item.title, route: null, dot: item.running && live ? "ongoing" : "done", state: item.running ? "running" : "idle",
        statusText: t(item.running && live ? "activity.task.running" : "activity.graph.session"), elapsed: null, upstream: [], unresolved: [], tooltip: "" }];
    }
    const executing = live && !isHistoricalTask(item) && !isSuspended(item);
    return [node.id, {
      title: taskTitle(item), route: taskRouteLine(item), dot: taskDot(item.status, executing), state: item.status,
      statusText: taskLabel(item.status, t), elapsed: taskElapsed(item, now, live), upstream: upstream.filter((id) => id !== root.id), unresolved: [],
      tooltip: item.task_id, taskId: item.task_id,
    }];
  })), [layout, live, now, t, root.id]);
  const laneLabel = (index: number | null): string => index === 0 ? t("activity.graph.session") : t("activity.graph.depth", { index: index ?? 0 });
  return <GraphCanvas layout={layout} cards={cards} laneLabel={laneLabel} testId="agent-graph" nodeTestId="agent-graph-node" hint={t("activity.graph.treeHint")}
    onActivate={(id) => { const taskId = cards.get(id)?.taskId; if (taskId !== undefined) onOpen(taskId); }} />;
}
