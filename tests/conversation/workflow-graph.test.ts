import { describe, expect, it } from "vitest";
import type { DagNode, DagRun } from "../../shared/protocol";
import {
  CANVAS_ORIGIN_Y, CANVAS_PADDING, CARD_HEIGHT, CARD_WIDTH, COLUMN_GAP, COLUMN_PITCH, EDGE_ARROW, MAX_SCALE, MIN_SCALE, ROW_PITCH,
  dependencyEdges, fitScale, layoutWorkflowGraph, neighborNode, zoomIn, zoomOut,
} from "../../src/ui/conversation/workflow-graph";

const AT = "2026-10-05T00:00:00.000Z";
function node(id: string, depends_on: string[] = []): DagNode {
  return { id, prompt: id, state: "completed", depends_on, attempt: 1, created_at: AT };
}
function run(nodes: DagNode[], edges: DagRun["edges"] = []): DagRun {
  return { run_id: "r", run_key: "k", name: "Build", status: "running", created_at: AT, updated_at: AT, counts: {}, nodes, edges, waves: [] };
}
const diamond = run([node("A"), node("B", ["A"]), node("C", ["A"]), node("D", ["B", "C"])]);

describe("workflow graph geometry", () => {
  it("places dependency columns at the column pitch and rows at the row pitch", () => {
    const layout = layoutWorkflowGraph(diamond);
    expect(layout.columns.map((column) => column.nodeIds)).toEqual([["A"], ["B", "C"], ["D"]]);
    expect(layout.columns.map((column) => column.index)).toEqual([0, 1, 2]);
    const [b, c, d] = [layout.byId.get("B"), layout.byId.get("C"), layout.byId.get("D")];
    expect([b?.x, b?.y]).toEqual([CANVAS_PADDING + COLUMN_PITCH, CANVAS_ORIGIN_Y]);
    expect(c !== undefined && b !== undefined ? c.y - b.y : null).toBe(ROW_PITCH);
    expect(d !== undefined && b !== undefined ? d.x - b.x : null).toBe(COLUMN_PITCH);
    expect(layout.width).toBe(CANVAS_PADDING * 2 + 3 * CARD_WIDTH + 2 * COLUMN_GAP);
    expect(layout.height).toBe(CANVAS_ORIGIN_Y + ROW_PITCH + CARD_HEIGHT + CANVAS_PADDING);
  });
  it("draws each real dependency once, from the source's right midpoint to the target's left midpoint", () => {
    const graph = run([node("A"), node("B", ["A"])], [{ from: "A", to: "B" }, { from: "A", to: "B" }, { from: "B", to: "B" }]);
    expect(dependencyEdges(graph)).toEqual([{ from: "A", to: "B" }]);
    const layout = layoutWorkflowGraph(graph);
    const a = layout.byId.get("A");
    const b = layout.byId.get("B");
    if (a === undefined || b === undefined) throw new Error("both nodes are placed");
    const [sx, sy, tx, ty] = [a.x + CARD_WIDTH, a.y + CARD_HEIGHT / 2, b.x, b.y + CARD_HEIGHT / 2];
    expect(layout.edges).toEqual([{
      id: "A->B", from: "A", to: "B",
      path: `M${sx} ${sy} C${sx + COLUMN_GAP / 2} ${sy}, ${tx - COLUMN_GAP / 2} ${ty}, ${tx} ${ty}`,
      arrow: `M${tx} ${ty} L${tx - EDGE_ARROW} ${ty + EDGE_ARROW / 2} L${tx - EDGE_ARROW} ${ty - EDGE_ARROW / 2} Z`,
    }]);
    expect(b.upstream).toEqual(["A"]);
    expect(a.downstream).toEqual(["B"]);
  });
  it("lists unknown dependencies without drawing them and keeps cycles in the unresolved column", () => {
    const layout = layoutWorkflowGraph(run([node("A", ["ghost"]), node("B", ["C"]), node("C", ["B"])], [{ from: "A", to: "nowhere" }]));
    expect(layout.edges.map((edge) => edge.id)).toEqual(["C->B", "B->C"]);
    expect(layout.byId.get("A")?.unresolved).toEqual(["ghost"]);
    expect(layout.byId.get("A")?.upstream).toEqual([]);
    expect(layout.columns).toEqual([{ index: null, x: CANVAS_PADDING, nodeIds: ["A", "B", "C"] }]);
    for (const edge of layout.edges) {
      expect(edge.path).toMatch(/^M-?[\d.]+ -?[\d.]+ C(-?[\d.]+ -?[\d.]+, ){2}-?[\d.]+ -?[\d.]+$/u);
      expect(edge.arrow).toMatch(/^M-?[\d.]+ -?[\d.]+( L-?[\d.]+ -?[\d.]+){2} Z$/u);
    }
  });
  it("orders rows by the rows of their dependencies to keep edges short", () => {
    const layout = layoutWorkflowGraph(run([node("A"), node("B"), node("C", ["B"]), node("D", ["A"]), node("E")]));
    expect(layout.columns[0]?.nodeIds).toEqual(["A", "B", "E"]);
    expect(layout.columns[1]?.nodeIds).toEqual(["D", "C"]);
    expect(layout.byId.get("C")?.row).toBe(1);
  });
  it("walks neighbors along drawn edges and within a column", () => {
    const layout = layoutWorkflowGraph(diamond);
    expect(neighborNode(layout, "A", "right")).toBe("B");
    expect(neighborNode(layout, "D", "left")).toBe("B");
    expect(neighborNode(layout, "C", "right")).toBe("D");
    expect(neighborNode(layout, "B", "down")).toBe("C");
    expect(neighborNode(layout, "C", "up")).toBe("B");
    expect(neighborNode(layout, "C", "down")).toBeNull();
    expect(neighborNode(layout, "A", "left")).toBeNull();
    expect(neighborNode(layout, "missing", "right")).toBeNull();
  });
  it("fits to the viewport without upscaling and clamps zoom steps", () => {
    const canvas = { width: 1000, height: 400 };
    expect(fitScale(canvas, { width: 500 })).toBe(0.5);
    expect(fitScale(canvas, { width: 2000 })).toBe(1);
    expect(fitScale(canvas, { width: 0 })).toBe(1);
    expect(fitScale(canvas, { width: 2000, height: 100 })).toBe(0.25);
    expect(fitScale(canvas, { width: 10 })).toBe(MIN_SCALE);
    expect(zoomIn(1)).toBe(1.25);
    expect(zoomOut(1.25)).toBe(1);
    expect(zoomIn(MAX_SCALE)).toBe(MAX_SCALE);
    expect(zoomOut(MIN_SCALE)).toBe(MIN_SCALE);
  });
  it("sizes an empty run to its padding alone", () => {
    const layout = layoutWorkflowGraph(run([]));
    expect(layout).toMatchObject({ columns: [], nodes: [], edges: [], width: CANVAS_PADDING * 2, height: CANVAS_PADDING * 2 });
  });
});
