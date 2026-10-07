import type { DagNode, DagRun } from "../../../shared/protocol";
import { groupNodesByDependency } from "./activity-model";

/**
 * Pure geometry for the workflow graph: dependency columns of fixed-size cards joined by curved edges.
 * Every number is a CSS pixel of the unscaled canvas; WorkflowGraph.tsx applies the zoom as a transform.
 * The constants are the workflow reference in DESIGN.md (200px cards, 48px column gaps, 100px row pitch).
 */
export const CARD_WIDTH = 200;
export const CARD_HEIGHT = 72;
export const COLUMN_GAP = 48;
export const ROW_PITCH = 100;
export const COLUMN_PITCH = CARD_WIDTH + COLUMN_GAP;
export const CANVAS_PADDING = 16;
/** Band above the first row that carries the column (dependency layer) numbers. */
export const COLUMN_LABEL_HEIGHT = 24;
export const CANVAS_ORIGIN_Y = CANVAS_PADDING + COLUMN_LABEL_HEIGHT;
export const EDGE_ARROW = 6;

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2;
export const ZOOM_STEP = 1.25;

/** data-testid values of the graph; kebab-case like src/ui/testids.ts, kept here until TESTID carries them. */
export const GRAPH_TESTID = { graph: "workflow-graph", node: "workflow-graph-node" } as const;

export interface GraphEdge {
  from: string;
  to: string;
}

export interface GraphColumn {
  /** Dependency layer from groupNodesByDependency; null is the column of cyclic or unknown dependencies. */
  index: number | null;
  x: number;
  nodeIds: string[];
}

export interface GraphNodeLayout {
  node: DagNode;
  column: number;
  row: number;
  x: number;
  y: number;
  /** Dependencies with a card in this run, in edge order; each is drawn. */
  upstream: string[];
  downstream: string[];
  /** Dependency ids without a node in this run: listed on the card, never drawn as a line. */
  unresolved: string[];
}

export interface GraphEdgeLayout {
  id: string;
  from: string;
  to: string;
  /** Cubic Bezier from the source card's right midpoint to the target card's left midpoint. */
  path: string;
  /** Closed triangle whose tip is the target endpoint, aligned with the curve's end tangent. */
  arrow: string;
}

export interface GraphLayout {
  columns: GraphColumn[];
  nodes: GraphNodeLayout[];
  byId: ReadonlyMap<string, GraphNodeLayout>;
  edges: GraphEdgeLayout[];
  width: number;
  height: number;
}

export interface GraphSize {
  width: number;
  height: number;
}

/** Every dependency pair once, from node.depends_on then run.edges, in first-appearance order; never a self link. */
export function dependencyEdges(run: DagRun): GraphEdge[] {
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  const add = (from: string, to: string): void => {
    const key = `${from}\u0000${to}`;
    if (from === to || seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to });
  };
  for (const node of run.nodes) for (const from of node.depends_on) add(from, node.id);
  for (const edge of run.edges) add(edge.from, edge.to);
  return edges;
}

function format(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Rows follow the mean row of already placed dependencies; nodes without one keep snapshot order after them. */
function orderRows(nodes: readonly DagNode[], upstream: ReadonlyMap<string, string[]>, rowOf: ReadonlyMap<string, number>): DagNode[] {
  const keyed = nodes.map((node, index) => {
    const rows = (upstream.get(node.id) ?? []).flatMap((id) => {
      const row = rowOf.get(id);
      return row === undefined ? [] : [row];
    });
    const key = rows.length === 0 ? null : rows.reduce((sum, row) => sum + row, 0) / rows.length;
    return { node, index, key };
  });
  keyed.sort((a, b) => {
    if (a.key === null || b.key === null) return a.key === b.key ? a.index - b.index : a.key === null ? 1 : -1;
    return a.key - b.key || a.index - b.index;
  });
  return keyed.map((entry) => entry.node);
}

function edgeGeometry(from: GraphNodeLayout, to: GraphNodeLayout): Pick<GraphEdgeLayout, "path" | "arrow"> {
  const sx = from.x + CARD_WIDTH;
  const sy = from.y + CARD_HEIGHT / 2;
  const tx = to.x;
  const ty = to.y + CARD_HEIGHT / 2;
  const forward = to.column > from.column;
  // A forward edge bends across the gap; a backward or same-column edge (a cycle) loops out of the source's
  // right side, dips below the row and returns into the target's left side so it never hides behind the cards.
  const reach = forward ? (tx - sx) / 2 : COLUMN_GAP;
  const drop = forward ? 0 : ROW_PITCH * 0.6;
  const c1 = { x: sx + reach, y: sy + drop };
  const c2 = { x: tx - reach, y: ty + drop };
  const path = `M${format(sx)} ${format(sy)} C${format(c1.x)} ${format(c1.y)}, ${format(c2.x)} ${format(c2.y)}, ${format(tx)} ${format(ty)}`;
  const tangent = { x: tx - c2.x, y: ty - c2.y };
  const length = Math.hypot(tangent.x, tangent.y) || 1;
  const unit = { x: tangent.x / length, y: tangent.y / length };
  const normal = { x: -unit.y, y: unit.x };
  const base = { x: tx - unit.x * EDGE_ARROW, y: ty - unit.y * EDGE_ARROW };
  const half = EDGE_ARROW / 2;
  const arrow = `M${format(tx)} ${format(ty)} L${format(base.x + normal.x * half)} ${format(base.y + normal.y * half)}` +
    ` L${format(base.x - normal.x * half)} ${format(base.y - normal.y * half)} Z`;
  return { path, arrow };
}

/** Columns are groupNodesByDependency's layers left to right; the canvas is sized to the deepest column. */
export function layoutWorkflowGraph(run: DagRun): GraphLayout {
  const ids = new Set(run.nodes.map((node) => node.id));
  const upstream = new Map<string, string[]>();
  const downstream = new Map<string, string[]>();
  const unresolved = new Map<string, string[]>();
  for (const node of run.nodes) {
    upstream.set(node.id, []);
    downstream.set(node.id, []);
    unresolved.set(node.id, []);
  }
  const edges = dependencyEdges(run).filter((edge) => ids.has(edge.to));
  for (const edge of edges) {
    if (ids.has(edge.from)) {
      upstream.get(edge.to)?.push(edge.from);
      downstream.get(edge.from)?.push(edge.to);
    } else {
      unresolved.get(edge.to)?.push(edge.from);
    }
  }
  const rowOf = new Map<string, number>();
  const columns: GraphColumn[] = [];
  const nodes: GraphNodeLayout[] = [];
  const byId = new Map<string, GraphNodeLayout>();
  groupNodesByDependency(run).forEach((group, column) => {
    const ordered = orderRows(group.nodes, upstream, rowOf);
    const x = CANVAS_PADDING + column * COLUMN_PITCH;
    columns.push({ index: group.index, x, nodeIds: ordered.map((node) => node.id) });
    ordered.forEach((node, row) => {
      rowOf.set(node.id, row);
      const placed: GraphNodeLayout = {
        node, column, row, x, y: CANVAS_ORIGIN_Y + row * ROW_PITCH,
        upstream: upstream.get(node.id) ?? [], downstream: downstream.get(node.id) ?? [], unresolved: unresolved.get(node.id) ?? [],
      };
      nodes.push(placed);
      byId.set(node.id, placed);
    });
  });
  const drawn = edges.flatMap((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (from === undefined || to === undefined) return [];
    return [{ id: `${edge.from}->${edge.to}`, from: edge.from, to: edge.to, ...edgeGeometry(from, to) }];
  });
  const rows = columns.reduce((max, column) => Math.max(max, column.nodeIds.length), 0);
  return {
    columns, nodes, byId, edges: drawn,
    width: columns.length === 0 ? CANVAS_PADDING * 2 : CANVAS_PADDING * 2 + columns.length * CARD_WIDTH + (columns.length - 1) * COLUMN_GAP,
    height: rows === 0 ? CANVAS_PADDING * 2 : CANVAS_ORIGIN_Y + (rows - 1) * ROW_PITCH + CARD_HEIGHT + CANVAS_PADDING,
  };
}

export function clampScale(scale: number): number {
  return Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)) * 1000) / 1000;
}

/** The largest scale at or below 1 that shows the whole canvas; a viewport dimension of 0 or less does not constrain. */
export function fitScale(canvas: GraphSize, viewport: { width: number; height?: number }): number {
  const limits = [1];
  if (viewport.width > 0 && canvas.width > 0) limits.push(viewport.width / canvas.width);
  if (viewport.height !== undefined && viewport.height > 0 && canvas.height > 0) limits.push(viewport.height / canvas.height);
  return clampScale(Math.min(...limits));
}

export function zoomIn(scale: number): number {
  return clampScale(scale * ZOOM_STEP);
}

export function zoomOut(scale: number): number {
  return clampScale(scale / ZOOM_STEP);
}

export type GraphDirection = "up" | "down" | "left" | "right";

/** Keyboard neighbor: left/right follow drawn edges to the dependency or dependent in the nearest row; up/down stay in the column. */
export function neighborNode(layout: GraphLayout, id: string, direction: GraphDirection): string | null {
  const origin = layout.byId.get(id);
  if (origin === undefined) return null;
  if (direction === "up" || direction === "down") {
    const column = layout.columns[origin.column];
    return column?.nodeIds[origin.row + (direction === "up" ? -1 : 1)] ?? null;
  }
  const candidates = direction === "left" ? origin.upstream : origin.downstream;
  let best: GraphNodeLayout | null = null;
  for (const candidateId of candidates) {
    const candidate = layout.byId.get(candidateId);
    if (candidate !== undefined && (best === null || Math.abs(candidate.row - origin.row) < Math.abs(best.row - origin.row))) best = candidate;
  }
  return best?.node.id ?? null;
}
