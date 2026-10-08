import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button, IconFullscreenOutlineRegular, StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import type { DagRun } from "../../../shared/protocol";
import { useLocale, useT, type MessageKey, type Translate } from "../../i18n";
import { knownNodeState, nodeDot, nodeElapsedMs, type NodeState } from "./activity-model";
import { formatDuration } from "./format";
import {
  CANVAS_PADDING, CARD_HEIGHT, CARD_WIDTH, COLUMN_LABEL_HEIGHT, GRAPH_TESTID, MAX_SCALE, MIN_SCALE,
  fitScale, layoutWorkflowGraph, neighborNode, zoomIn, zoomOut, type GraphDirection,
} from "./workflow-graph";
import css from "./WorkflowGraph.module.css";

/** Same table as ActivityPanel's private one: the status word next to every status color. */
const NODE_LABELS = {
  pending: "activity.node.pending", blocked: "activity.node.blocked", scheduled: "activity.node.scheduled",
  running: "activity.node.running", completed: "activity.node.completed", failed: "activity.node.failed",
  cancelled: "activity.node.cancelled", skipped: "activity.node.skipped",
} as const satisfies Record<NodeState, MessageKey>;

/** Pending dictionary keys (activity.graph.zoom / zoomIn / zoomOut / fit / unresolved); local until src/i18n/activity.ts carries them. */
const LABELS = {
  en: { zoom: "Zoom", zoomIn: "Zoom in", zoomOut: "Zoom out", fit: "Fit", unresolved: "Unknown dependencies: {nodes}" },
  ko: { zoom: "확대/축소", zoomIn: "확대", zoomOut: "축소", fit: "맞춤", unresolved: "알 수 없는 선행 작업: {nodes}" },
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
  const labels = LABELS[useLocale()];
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
    <section className={css.root} data-testid={GRAPH_TESTID.graph} data-run-id={run.run_id} data-fit={fitted ? "" : undefined}
      aria-label={t("activity.graph")} onKeyDown={onKeyDown}>
      <div className={css.toolbar} role="toolbar" aria-label={labels.zoom}>
        <Button size="sm" variant="outline" className={css.zoomButton} aria-label={labels.zoomOut} disabled={scale <= MIN_SCALE}
          onClick={() => setManualScale(zoomOut(scale))}>−</Button>
        <output className={css.scale} aria-label={labels.zoom}>{Math.round(scale * 100)}%</output>
        <Button size="sm" variant="outline" className={css.zoomButton} aria-label={labels.zoomIn} disabled={scale >= MAX_SCALE}
          onClick={() => setManualScale(zoomIn(scale))}>+</Button>
        <Button size="sm" variant="outline" icon={<IconFullscreenOutlineRegular size={14} />} aria-pressed={fitted}
          onClick={() => setManualScale(null)}>{labels.fit}</Button>
      </div>
      <div ref={viewportRef} className={css.viewport}>
        {layout.nodes.length === 0 ? <p className={css.empty}>{t("activity.run.empty")}</p> : (
          <div className={css.stage} style={{ width: layout.width * scale, height: layout.height * scale }}>
            <div className={css.canvas} style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
              <svg className={css.edges} width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
                {layout.edges.map((edge) => (
                  <g key={edge.id} data-state={nodeDot(layout.byId.get(edge.from)?.node.state ?? "pending", live)}
                    data-edge-from={edge.from} data-edge-to={edge.to}>
                    <path className={css.edge} d={edge.path} />
                    <path className={css.arrow} d={edge.arrow} />
                  </g>
                ))}
              </svg>
              {layout.columns.map((column) => (
                <span key={column.index ?? "rest"} className={css.columnLabel} title={t("activity.layer")}
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
                const unresolvedLine = unresolved.length === 0 ? null : labels.unresolved.replace("{nodes}", unresolved.join(", "));
                return (
                  <button key={node.id} type="button" className={css.node} data-testid={GRAPH_TESTID.node} data-node-id={node.id}
                    data-state={node.state} data-dot={dot} data-column={column} data-row={row}
                    ref={(element) => { if (element === null) cardRefs.current.delete(node.id); else cardRefs.current.set(node.id, element); }}
                    style={{ left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT }}
                    title={[statusText, label, dependsLine, unresolvedLine, node.last_error?.message, node.prompt].filter(Boolean).join("\n")}
                    onClick={() => onSelect(node.id)}>
                    <span className={css.nodeHead}>
                      <StateDot state={dot} size={10} />
                      <span className={css.nodeName}>{label}</span>
                    </span>
                    <span className={css.nodeMeta}>
                      <span className={css.nodeStatus}>{statusText}</span>
                      <span className={css.nodeElapsed}>{elapsed === null ? "—" : formatDuration(elapsed, t)}</span>
                    </span>
                    {dependencies.length > 0 && (
                      <span className={css.nodeDeps}>
                        <span aria-hidden="true">← </span>
                        {upstream.join(" · ")}
                        {upstream.length > 0 && unresolved.length > 0 && " · "}
                        {unresolved.length > 0 && <span className={css.unresolved} title={unresolvedLine ?? undefined}>{unresolved.join(" · ")} ?</span>}
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
