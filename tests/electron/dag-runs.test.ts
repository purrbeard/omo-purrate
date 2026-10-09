import { mkdir, mkdtemp, realpath, rename, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { taskStore } from "../../electron/history/task-work";
import { loadPersistedDagRuns } from "../../electron/workbench/dag-runs";

const createdAt = "2026-10-08T10:00:00.000Z";
const updatedAt = "2026-10-08T11:00:00.000Z";
const run = {
  runId: "dag_one", runKey: "key", name: "Run", parentSessionId: "parent", status: "completed", createdAt, updatedAt, completedAt: updatedAt,
  nodes: [
    { id: "a", label: "First", prompt: "Do work", dependsOn: [], state: "completed", attempt: 1, createdAt, taskId: "st_one", startedAt: createdAt, completedAt: updatedAt },
    { id: "b", prompt: "Next", dependsOn: ["a"], state: "failed", attempt: 2, createdAt, lastError: { code: "failed", message: "detail" } },
  ],
  edges: [{ from: "a", to: "b" }], waves: [{ index: 0, nodeIds: ["a"] }, { index: 1, nodeIds: ["b"] }],
};

async function store() {
  const root = await mkdtemp(path.join(os.tmpdir(), "omo-dag-runs-"));
  const cwd = await realpath(root);
  const agentDir = path.join(root, "agent");
  const directory = path.join(await taskStore(agentDir, cwd), "dag", "runs");
  await mkdir(directory, { recursive: true });
  return { root, agentDir, cwd, directory };
}

describe("persisted DAG runs", () => {
  it("maps real camelCase records and filters other sessions and malformed files", async () => {
    const { agentDir, cwd, directory } = await store();
    await writeFile(path.join(directory, "one.json"), JSON.stringify(run));
    await writeFile(path.join(directory, "other.json"), JSON.stringify({ ...run, parentSessionId: "other" }));
    await writeFile(path.join(directory, "malformed.json"), "{");
    await writeFile(path.join(directory, "invalid.json"), JSON.stringify({ ...run, nodes: [{ ...run.nodes[0], dependsOn: "a" }] }));
    expect(await loadPersistedDagRuns(agentDir, cwd, "parent")).toEqual([{
      run_id: "dag_one", run_key: "key", name: "Run", status: "completed", created_at: createdAt, updated_at: updatedAt, completed_at: updatedAt,
      counts: { completed: 1, failed: 1 },
      nodes: [
        { id: "a", label: "First", prompt: "Do work", depends_on: [], state: "completed", attempt: 1, created_at: createdAt, task_id: "st_one", started_at: createdAt, completed_at: updatedAt },
        { id: "b", prompt: "Next", depends_on: ["a"], state: "failed", attempt: 2, created_at: createdAt, last_error: { code: "failed", message: "detail" } },
      ], edges: run.edges, waves: [{ index: 0, node_ids: ["a"] }, { index: 1, node_ids: ["b"] }],
    }]);
  });

  it("sorts by update time, caps at 20, and contains a redirected runs directory", async () => {
    const { root, agentDir, cwd, directory } = await store();
    for (let index = 0; index < 22; index += 1) {
      await writeFile(path.join(directory, `${index}.json`), JSON.stringify({ ...run, runId: `dag_${index}`, updatedAt: new Date(Date.parse(updatedAt) + index * 1000).toISOString() }));
    }
    const runs = await loadPersistedDagRuns(agentDir, cwd, "parent");
    expect(runs).toHaveLength(20);
    expect(runs[0]?.run_id).toBe("dag_21");
    expect(runs[19]?.run_id).toBe("dag_2");
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "escape.json"), JSON.stringify(run));
    await rename(directory, `${directory}-original`);
    await symlink(outside, directory, process.platform === "win32" ? "junction" : "dir");
    expect(await loadPersistedDagRuns(agentDir, cwd, "parent")).toEqual([]);
  });

  it("returns an empty list for a missing store and rejects invalid ids and cwd", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "omo-dag-missing-"));
    expect(await loadPersistedDagRuns(path.join(cwd, "agent"), cwd, "parent")).toEqual([]);
    await expect(loadPersistedDagRuns(cwd, cwd, "../parent")).rejects.toThrow(/thread id/);
    await expect(loadPersistedDagRuns(cwd, ".", "parent")).rejects.toThrow(/absolute/);
  });
});
