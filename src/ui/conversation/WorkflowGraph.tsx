import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Maximize } from "lucide-react";
import type { DagRun } from "../../../shared/protocol";
import { useT, type MessageKey, type Translate } from "../../i18n";
import { knownNodeState, nodeDot, nodeElapsedMs, type NodeState } from "./activity-model";
import { formatDuration } from "./format";
import {
  CANVAS_PADDING, CARD_HEIGHT, CARD_WIDTH, COLUMN_LABEL_HEIGHT, GRAPH_TESTID, MAX_SCALE, MIN_SCALE,
  fitScale, layoutWorkflowGraph, neighborNode, zoomIn, zoomOut, type GraphDirection,
} from "./workflow-graph";
import { Button, StateDot } from "../kit";

/** Same table as ActivityPanel's private one: the status word next to every status color. */
const NODE_LABELS = {
  pending: "activity.node.pending", blocked: "activity.node.blocked", scheduled: "activity.node.scheduled",
  running: "activity.node.running", completed: "activity.node.completed", failed: "activity.node.failed",
  cancelled: "activity.node.cancelled", skipped: "activity.node.skipped",
} as const satisfies Record<NodeState, MessageKey>;

/** Classes per graph part; geometry arrives as inline sizes from workflow-graph.ts. */
const G = {
  root: "flex min-w-0 flex-col gap-2 pt-2 pb-3",
  toolbar: "flex flex-none items-center gap-1 px-3",
  zoomButton: "h-7! w-7! px-0! text-sm!",
  scale: "min-w-11 text-center text-[11px] text-muted-foreground tabular-nums",
  viewport: "relative min-w-0 overflow-x-auto overflow-y-hidden",
  stage: "relative overflow-hidden",
  canvas: "absolute top-0 left-0 origin-top-left bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-size-[16px_16px]",
  edges: "pointer-events-none absolute inset-0 overflow-visible [&_g]:text-border [&_g[data-state=done]]:text-success [&_g[data-state=ongoing]]:text-ring [&_g[data-state=error]]:text-destructive-foreground [&_g[data-state=warning]]:text-warning",
  edge: "fill-none stroke-current [stroke-linecap:round] [stroke-width:1.5]",
  arrow: "fill-current stroke-none",
  columnLabel: "absolute box-border text-center text-[10px] leading-4 text-muted-foreground tabular-nums",
  node: "group/node absolute m-0 box-border flex cursor-pointer flex-col gap-0.5 rounded-[var(--dsw-radius-sm)] border border-solid border-border bg-card px-3 py-2 text-left [font-family:inherit] text-xs leading-[18px] text-foreground shadow-[inset_3px_0_0_var(--border)] transition-[background-color,border-color] duration-[120ms] hover:bg-accent active:bg-secondary motion-reduce:transition-none data-[dot=done]:shadow-[inset_3px_0_0_var(--success)] data-[dot=error]:shadow-[inset_3px_0_0_var(--destructive-foreground)] data-[dot=ongoing]:shadow-[inset_3px_0_0_var(--ring)] data-[dot=warning]:shadow-[inset_3px_0_0_var(--warning)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
  nodeHead: "flex min-w-0 items-center gap-1.5",
  nodeName: "min-w-0 truncate font-medium",
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

/** Dependency columns of status cards joined by curved edges; the viewport owns horizontal overflow and fits by default. */
export function WorkflowGraph({ run, live, now, onSelect }: {
  run: DagRun; live: boolean; now: number; onSelect: (nodeId: string) => void;
}) {
  const t = useT();
  const layout = useMemo(() => layoutWorkflowGraph(run), [run]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const [viewportWidth, setViewportWidth] = useState(0);
  /** null keeps the fit scale, following viewport and layout changes; a number is a zoom the user chose. */
  const [manualScale, setManualScale] = useState<number | null>(null);
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
  const scale = manualScale ?? fitScale(layout, { width: viewportWidth });
  const fitted = manualScale === null;
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
  return (
    <section className={G.root} data-testid={GRAPH_TESTID.graph} data-run-id={run.run_id} data-fit={fitted ? "" : undefined}
      aria-label={t("activity.graph")} onKeyDown={onKeyDown}>
      <div className={G.toolbar} role="toolbar" aria-label={t("activity.graph.zoom")}>
        <Button size="sm" variant="outline" className={G.zoomButton} aria-label={t("activity.graph.zoomOut")} disabled={scale <= MIN_SCALE}
          onClick={() => setManualScale(zoomOut(scale))}>−</Button>
        <output className={G.scale} aria-label={t("activity.graph.zoom")}>{Math.round(scale * 100)}%</output>
        <Button size="sm" variant="outline" className={G.zoomButton} aria-label={t("activity.graph.zoomIn")} disabled={scale >= MAX_SCALE}
          onClick={() => setManualScale(zoomIn(scale))}>+</Button>
        <Button size="sm" variant="outline" className="h-7! px-2.5! [&_svg]:size-3.5!" icon={<Maximize aria-hidden />} aria-pressed={fitted}
          onClick={() => setManualScale(null)}>{t("activity.graph.fit")}</Button>
      </div>
      <div ref={viewportRef} className={G.viewport}>
        {layout.nodes.length === 0 ? <p className={G.empty}>{t("activity.run.empty")}</p> : (
          <div className={G.stage} data-graph-stage style={{ width: layout.width * scale, height: layout.height * scale }}>
            <div className={G.canvas} style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
              <svg className={G.edges} width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
                {layout.edges.map((edge) => (
                  <g key={edge.id} data-state={nodeDot(layout.byId.get(edge.from)?.node.state ?? "pending", live)}
                    data-edge-from={edge.from} data-edge-to={edge.to}>
                    <path className={G.edge} d={edge.path} />
                    <path className={G.arrow} d={edge.arrow} />
                  </g>
                ))}
              </svg>
              {layout.columns.map((column) => (
                <span key={column.index ?? "rest"} className={G.columnLabel} title={t("activity.layer")}
                  style={{ left: column.x, top: CANVAS_PADDING, width: CARD_WIDTH, height: COLUMN_LABEL_HEIGHT }}>
                  {column.index === null ? "—" : column.index + 1}
                </span>
              ))}
              {layout.nodes.map(({ node, x, y, column, row, upstream, unresolved }) => {
                const label = node.label?.trim() || node.id;
                const dot = nodeDot(node.state, live);
                const statusText = nodeLabel(node.state, t);
                const elapsed = nodeElapsedMs(node, now, live);
                const dependencies = [...upstream, ...unresolved];
                const dependsLine = dependencies.length === 0 ? null : t("activity.depends", { nodes: dependencies.join(", ") });
                const unresolvedLine = unresolved.length === 0 ? null : t("activity.graph.unresolved", { nodes: unresolved.join(", ") });
                return (
                  <button key={node.id} type="button" className={G.node} data-testid={GRAPH_TESTID.node} data-node-id={node.id}
                    data-state={node.state} data-dot={dot} data-column={column} data-row={row}
                    ref={(element) => { if (element === null) cardRefs.current.delete(node.id); else cardRefs.current.set(node.id, element); }}
                    style={{ left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT }}
                    title={[statusText, label, dependsLine, unresolvedLine, node.last_error?.message, node.prompt].filter(Boolean).join("\n")}
                    onClick={() => onSelect(node.id)}>
                    <span className={G.nodeHead}>
                      <StateDot state={dot} size={10} />
                      <span className={G.nodeName}>{label}</span>
                    </span>
                    <span className={G.nodeMeta}>
                      <span className={G.nodeStatus}>{statusText}</span>
                      <span className={G.nodeElapsed}>{elapsed === null ? "—" : formatDuration(elapsed, t)}</span>
                    </span>
                    {dependencies.length > 0 && (
                      <span className={G.nodeDeps}>
                        <span aria-hidden="true">← </span>
                        {upstream.join(" · ")}
                        {upstream.length > 0 && unresolved.length > 0 && " · "}
                        {unresolved.length > 0 && <span className={G.unresolved} title={unresolvedLine ?? undefined}>{unresolved.join(" · ")} ?</span>}
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
