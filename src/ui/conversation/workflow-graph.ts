import type { DagNode, DagRun } from "../../../shared/protocol";
import { groupNodesByDependency } from "./activity-model";

/**
 * Pure geometry for the workflow graph: lane columns (waves, dependency layers or agent depth) of fixed-size cards
 * joined by curved edges. Every number is a CSS pixel of the unscaled canvas; WorkflowGraph.tsx applies the zoom.
 * The constants follow the workflow reference in DESIGN.md (200px cards, 48px column gaps); a card holds four lines.
 */
export const CARD_WIDTH = 200;
export const CARD_HEIGHT = 88;
export const COLUMN_GAP = 48;
export const ROW_PITCH = 104;
export const COLUMN_PITCH = CARD_WIDTH + COLUMN_GAP;
export const CANVAS_PADDING = 16;
/** Band above the first row that carries the column (dependency layer) numbers. */
export const COLUMN_LABEL_HEIGHT = 24;
export const CANVAS_ORIGIN_Y = CANVAS_PADDING + COLUMN_LABEL_HEIGHT;
export const EDGE_ARROW = 6;

export const MIN_SCALE = 0.25;
/** The default zoom never shrinks cards below this; the viewport scrolls and pans for the rest, and Fit shows everything. */
export const READABLE_SCALE = 0.8;
export const MAX_SCALE = 2;
export const ZOOM_STEP = 1.25;

/** data-testid values of the graph; kebab-case like src/ui/testids.ts, kept here until TESTID carries them. */
export const GRAPH_TESTID = { graph: "workflow-graph", node: "workflow-graph-node" } as const;

export interface GraphEdge {
  from: string;
  to: string;
}

export interface GraphColumn {
  /** Wave index, dependency layer or tree depth; null is the column of cyclic, unknown or unscheduled nodes. */
  index: number | null;
  x: number;
  nodeIds: string[];
}

export interface GraphNodeLayout<T = DagNode> {
  node: T;
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

/** What the columns are: the run's waves, topological layers when the waves are missing or inconsistent, or tree depth. */
export type GraphLanes = "waves" | "dependencies" | "depth";

export interface GraphLayout<T = DagNode> {
  lanes: GraphLanes;
  columns: GraphColumn[];
  nodes: GraphNodeLayout<T>[];
  byId: ReadonlyMap<string, GraphNodeLayout<T>>;
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
function orderRows<T extends { id: string }>(nodes: readonly T[], upstream: ReadonlyMap<string, string[]>, rowOf: ReadonlyMap<string, number>): T[] {
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

function edgeGeometry(from: GraphNodeLayout<unknown>, to: GraphNodeLayout<unknown>): Pick<GraphEdgeLayout, "path" | "arrow"> {
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

interface ColumnGroup<T> {
  index: number | null;
  nodes: T[];
}

/**
 * The run's waves as columns when they are usable: every node in exactly one wave and every drawn dependency pointing
 * into a later wave. Null otherwise, so the caller falls back to topological layers.
 */
export function waveColumns(run: DagRun): ColumnGroup<DagNode>[] | null {
  if (run.waves.length === 0) return null;
  const byId = new Map(run.nodes.map((node) => [node.id, node]));
  const waveOf = new Map<string, number>();
  const groups: ColumnGroup<DagNode>[] = [];
  for (const wave of [...run.waves].sort((a, b) => a.index - b.index)) {
    const nodes: DagNode[] = [];
    for (const id of wave.node_ids) {
      const node = byId.get(id);
      if (node === undefined || waveOf.has(id)) return null;
      waveOf.set(id, wave.index);
      nodes.push(node);
    }
    if (nodes.length > 0) groups.push({ index: wave.index, nodes });
  }
  if (waveOf.size !== run.nodes.length) return null;
  for (const edge of dependencyEdges(run)) {
    const from = waveOf.get(edge.from);
    const to = waveOf.get(edge.to);
    if (from !== undefined && to !== undefined && from >= to) return null;
  }
  return groups;
}

/** Places groups as left-to-right columns, rows ordered to keep edges short, and draws every edge between placed cards. */
function placeColumns<T extends { id: string }>(lanes: GraphLanes, groups: readonly ColumnGroup<T>[], edgeList: readonly GraphEdge[]): GraphLayout<T> {
  const ids = new Set(groups.flatMap((group) => group.nodes.map((node) => node.id)));
  const upstream = new Map<string, string[]>();
  const downstream = new Map<string, string[]>();
  const unresolved = new Map<string, string[]>();
  for (const id of ids) {
    upstream.set(id, []);
    downstream.set(id, []);
    unresolved.set(id, []);
  }
  const edges = edgeList.filter((edge) => ids.has(edge.to));
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
  const nodes: GraphNodeLayout<T>[] = [];
  const byId = new Map<string, GraphNodeLayout<T>>();
  groups.forEach((group, column) => {
    const ordered = orderRows(group.nodes, upstream, rowOf);
    const x = CANVAS_PADDING + column * COLUMN_PITCH;
    columns.push({ index: group.index, x, nodeIds: ordered.map((node) => node.id) });
    ordered.forEach((node, row) => {
      rowOf.set(node.id, row);
      const placed: GraphNodeLayout<T> = {
        node, column, row, x, y: CANVAS_ORIGIN_Y + row * ROW_PITCH,
        upstream: upstream.get(node.id) ?? [], downstream: downstream.get(node.id) ?? [], unresolved: unresolved.get(node.id) ?? [],
      };
      nodes.push(placed);
      byId.set(node.id, placed);
    });
  });
  return finish(lanes, columns, nodes, byId, edges);
}

function finish<T>(lanes: GraphLanes, columns: GraphColumn[], nodes: GraphNodeLayout<T>[], byId: Map<string, GraphNodeLayout<T>>, edges: readonly GraphEdge[]): GraphLayout<T> {
  const drawn = edges.flatMap((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (from === undefined || to === undefined) return [];
    return [{ id: `${edge.from}->${edge.to}`, from: edge.from, to: edge.to, ...edgeGeometry(from, to) }];
  });
  const bottom = nodes.reduce((max, node) => Math.max(max, node.y + CARD_HEIGHT), 0);
  return {
    lanes, columns, nodes, byId, edges: drawn,
    width: columns.length === 0 ? CANVAS_PADDING * 2 : CANVAS_PADDING * 2 + columns.length * CARD_WIDTH + (columns.length - 1) * COLUMN_GAP,
    height: nodes.length === 0 ? CANVAS_PADDING * 2 : bottom + CANVAS_PADDING,
  };
}

/** Columns are the run's waves left to right, or groupNodesByDependency's layers when the waves are missing or inconsistent. */
export function layoutWorkflowGraph(run: DagRun): GraphLayout {
  const waves = waveColumns(run);
  return placeColumns(waves === null ? "dependencies" : "waves", waves ?? groupNodesByDependency(run), dependencyEdges(run));
}

/** One agent of the ownership tree: a parent session or task and the tasks it started. */
export interface AgentTreeNode<T> {
  id: string;
  item: T;
  children: AgentTreeNode<T>[];
}

/**
 * Parent-to-child agent tree, one column per depth. Leaves take consecutive rows in depth-first order and a parent
 * sits level with the middle of its children, so every edge runs one column right.
 */
export function layoutAgentTree<T>(roots: readonly AgentTreeNode<T>[]): GraphLayout<AgentTreeNode<T>> {
  const columns: GraphColumn[] = [];
  const nodes: GraphNodeLayout<AgentTreeNode<T>>[] = [];
  const byId = new Map<string, GraphNodeLayout<AgentTreeNode<T>>>();
  const edges: GraphEdge[] = [];
  let nextSlot = 0;
  const seen = new Set<string>();
  const place = (tree: AgentTreeNode<T>, depth: number, parent: string | null): number => {
    seen.add(tree.id);
    const children = tree.children.filter((child) => !seen.has(child.id));
    const slots = children.map((child) => place(child, depth + 1, tree.id));
    const slot = slots.length === 0 ? nextSlot++ : (slots[0]! + slots.at(-1)!) / 2;
    const column = columns[depth] ?? (columns[depth] = { index: depth, x: CANVAS_PADDING + depth * COLUMN_PITCH, nodeIds: [] });
    const placed: GraphNodeLayout<AgentTreeNode<T>> = {
      node: tree, column: depth, row: 0, x: column.x, y: CANVAS_ORIGIN_Y + slot * ROW_PITCH,
      upstream: parent === null ? [] : [parent], downstream: children.map((child) => child.id), unresolved: [],
    };
    nodes.push(placed);
    byId.set(tree.id, placed);
    if (parent !== null) edges.push({ from: parent, to: tree.id });
    return slot;
  };
  for (const root of roots) if (!seen.has(root.id)) place(root, 0, null);
  for (const column of columns) {
    const ordered = nodes.filter((node) => node.column === column.index).sort((a, b) => a.y - b.y);
    column.nodeIds = ordered.map((node) => node.node.id);
    ordered.forEach((node, row) => { node.row = row; });
  }
  return finish("depth", columns, nodes, byId, edges);
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

/** Keyboard neighbor: left/right follow drawn edges to the dependency or dependent nearest in height; up/down stay in the column. */
export function neighborNode<T>(layout: GraphLayout<T>, id: string, direction: GraphDirection): string | null {
  const origin = layout.byId.get(id);
  if (origin === undefined) return null;
  if (direction === "up" || direction === "down") {
    const column = layout.columns[origin.column];
    return column?.nodeIds[origin.row + (direction === "up" ? -1 : 1)] ?? null;
  }
  const candidates = direction === "left" ? origin.upstream : origin.downstream;
  let best: GraphNodeLayout<T> | null = null;
  for (const candidateId of candidates) {
    const candidate = layout.byId.get(candidateId);
    if (candidate !== undefined && (best === null || Math.abs(candidate.y - origin.y) < Math.abs(best.y - origin.y))) best = candidate;
  }
  return best === null ? null : candidates.find((candidateId) => layout.byId.get(candidateId) === best) ?? null;
}
