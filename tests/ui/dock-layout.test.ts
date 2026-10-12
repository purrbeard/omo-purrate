import { describe, expect, it } from "vitest";
import { moveTab, parseDockLayout, RIGHT_TABS } from "../../src/ui/ui-state";

describe("moveTab", () => {
  it("moves a tab forward onto the target's position", () => {
    expect(moveTab(RIGHT_TABS, "agents", "terminal")).toEqual(["btw", "terminal", "agents", "workflow", "files"]);
  });
  it("moves a tab backward onto the target's position", () => {
    expect(moveTab(RIGHT_TABS, "files", "btw")).toEqual(["agents", "files", "btw", "terminal", "workflow"]);
  });
  it("leaves the order unchanged when a tab is dropped on itself", () => {
    expect(moveTab(RIGHT_TABS, "workflow", "workflow")).toEqual([...RIGHT_TABS]);
  });
});

describe("parseDockLayout", () => {
  it("restores a stored order and side", () => {
    const tabOrder = ["files", "agents", "btw", "terminal", "workflow"];
    expect(parseDockLayout(JSON.stringify({ tabOrder, dockSide: "left" }))).toEqual({ tabOrder, dockSide: "left" });
  });
  it("falls back to the defaults for missing, malformed or incomplete data", () => {
    const fallback = { tabOrder: [...RIGHT_TABS], dockSide: "right" };
    expect(parseDockLayout(null)).toEqual(fallback);
    expect(parseDockLayout("{")).toEqual(fallback);
    expect(parseDockLayout(JSON.stringify({ tabOrder: ["files", "files", "btw", "terminal", "workflow"], dockSide: "up" }))).toEqual(fallback);
  });
});
