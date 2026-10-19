import { describe, expect, it, vi } from "vitest";
import { moveTab, parseDockLayout, RIGHT_TABS, shownTab, uiState } from "../../src/ui/ui-state";

describe("moveTab", () => {
  it("moves a tab forward onto the target's position", () => {
    expect(moveTab(RIGHT_TABS, "work", "terminal")).toEqual(["btw", "terminal", "work", "files", "browser", "servers"]);
  });
  it("moves a tab backward onto the target's position", () => {
    expect(moveTab(RIGHT_TABS, "files", "btw")).toEqual(["work", "files", "btw", "terminal", "browser", "servers"]);
  });
  it("leaves the order unchanged when a tab is dropped on itself", () => {
    expect(moveTab(RIGHT_TABS, "files", "files")).toEqual([...RIGHT_TABS]);
  });
});

describe("parseDockLayout", () => {
  it("restores a stored order and side", () => {
    const tabOrder = ["files", "browser", "work", "btw", "terminal", "servers"];
    expect(parseDockLayout(JSON.stringify({ tabOrder, dockSide: "left" }))).toEqual({ tabOrder, dockSide: "left" });
  });
  it("appends tabs added since a layout was saved", () => {
    expect(parseDockLayout(JSON.stringify({ tabOrder: ["files", "work", "btw", "terminal"], dockSide: "right" })).tabOrder).toEqual(["files", "work", "btw", "terminal", "browser", "servers"]);
  });
  it("keeps a layout saved before Agents and Workflow merged, with Work where the first of them was", () => {
    const tabOrder = ["files", "agents", "btw", "terminal", "workflow"];
    expect(parseDockLayout(JSON.stringify({ tabOrder, dockSide: "left" }))).toEqual({ tabOrder: ["files", "work", "btw", "terminal", "browser", "servers"], dockSide: "left" });
  });
  it("falls back to the defaults for missing, malformed or incomplete data", () => {
    const fallback = { tabOrder: [...RIGHT_TABS], dockSide: "right" };
    expect(parseDockLayout(null)).toEqual(fallback);
    expect(parseDockLayout("{")).toEqual(fallback);
    expect(parseDockLayout(JSON.stringify({ tabOrder: ["files", "files", "btw", "terminal"], dockSide: "up" }))).toEqual(fallback);
  });
});

describe("shownTab", () => {
  const base = { rightTab: null, agentAuto: true, canDock: true, workAvailable: true } as const;
  it("opens Work by itself for a session with work while there is room", () => {
    expect(shownTab(base)).toBe("work");
    expect(shownTab({ ...base, canDock: false })).toBeNull();
    expect(shownTab({ ...base, workAvailable: false })).toBeNull();
  });
  it("stays closed once the user closed the auto-opened panel, and a chosen tab wins", () => {
    expect(shownTab({ ...base, agentAuto: false })).toBeNull();
    expect(shownTab({ ...base, rightTab: "files" })).toBe("files");
  });
});

describe("closing the dock", () => {
  it("closes the auto-opened Work panel through the same toggles as a chosen tab, and the dock toggle reopens the last tab", () => {
    uiState.setWorkAvailable(true);
    expect(shownTab(uiState.get())).toBe("work");
    uiState.toggleRightTab("work");
    expect(shownTab(uiState.get())).toBeNull();
    uiState.setWorkAvailable(false);
    uiState.setWorkAvailable(true);
    expect(shownTab(uiState.get())).toBeNull();
    uiState.toggleRightTab("terminal");
    expect(shownTab(uiState.get())).toBe("terminal");
    uiState.toggleDock();
    expect(shownTab(uiState.get())).toBeNull();
    uiState.toggleDock();
    expect(shownTab(uiState.get())).toBe("terminal");
    uiState.toggleWork("graph");
    expect(uiState.get()).toMatchObject({ rightTab: "work", workView: "graph", workflowPanelOpen: true, agentPanelOpen: false });
    uiState.toggleWork("agents");
    expect(uiState.get()).toMatchObject({ rightTab: "work", workView: "agents", agentPanelOpen: true });
    uiState.closeRightTab("work");
    expect(shownTab(uiState.get())).toBeNull();
  });
});

describe("the surface launcher", () => {
  it("opens while no surface was chosen, and a chosen surface replaces it", async () => {
    vi.resetModules();
    const { uiState: fresh } = await import("../../src/ui/ui-state");
    fresh.toggleDock();
    expect(fresh.get()).toMatchObject({ dockLauncher: true, rightTab: null });
    fresh.openFiles("all");
    expect(fresh.get()).toMatchObject({ dockLauncher: false, rightTab: "files", filesView: "all" });
    fresh.closeRightTab("files");
    fresh.toggleDock();
    expect(fresh.get()).toMatchObject({ dockLauncher: false, rightTab: "files" });
  });
});
