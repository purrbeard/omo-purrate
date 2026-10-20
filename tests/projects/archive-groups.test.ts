import { describe, expect, it } from "vitest";
import type { Thread } from "../../shared/protocol";
import { archivedProjects, groupArchived, UNKNOWN_PROJECT } from "../../src/ui/projects/archive-groups";

function thread(id: string, cwd: string, updatedAt: number, name: string | null = null, preview = ""): Thread {
  return { id, cwd, updatedAt, createdAt: updatedAt, name, preview, status: { type: "notLoaded" }, path: null, turns: [] };
}

const threads = [
  thread("a1", "C:/work/alpha", 100, "Fix login"),
  thread("a2", "c:\\work\\alpha\\", 300, null, "Add Search"),
  thread("b1", "C:/work/beta", 200, "Beta login flow"),
  thread("u1", "", 900, "Orphan"),
];

describe("groupArchived", () => {
  it("groups by project, newest first, with the unknown project last", () => {
    const groups = groupArchived(threads, "", null);
    expect(groups.map(group => group.threads.map(entry => entry.id))).toEqual([["a2", "a1"], ["b1"], ["u1"]]);
    expect(groups.at(-1)?.key).toBe(UNKNOWN_PROJECT);
  });

  it("filters by project and by title or preview substring", () => {
    const [alpha] = groupArchived(threads, "", null);
    expect(groupArchived(threads, "", alpha!.key).flatMap(group => group.threads.map(entry => entry.id))).toEqual(["a2", "a1"]);
    expect(groupArchived(threads, "LOGIN", null).flatMap(group => group.threads.map(entry => entry.id))).toEqual(["b1", "a1"]);
    expect(groupArchived(threads, "search", alpha!.key).flatMap(group => group.threads.map(entry => entry.id))).toEqual(["a2"]);
    expect(groupArchived(threads, "login", UNKNOWN_PROJECT)).toEqual([]);
  });

  it("lists each archived project once", () => {
    expect(archivedProjects(threads).map(project => project.key)).toHaveLength(3);
  });
});
