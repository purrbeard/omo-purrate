import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { readTeams } from "../../electron/history/teams";
import { taskStore } from "../../electron/history/task-work";

it("shows only the session's authoritative team state without changing it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "purrate-teams-"));
  const agent = path.join(root, "agent");
  const cwd = path.join(root, "project");
  await mkdir(cwd);
  const store = await taskStore(agent, cwd);
  const states = [{ version: 1, teamRunId: "one", teamName: "owned", status: "active", leadSessionId: "lead", members: [{ name: "worker", sessionId: "child", status: "idle", model: { providerID: "local", modelID: "test" } }] },
    { version: 1, teamRunId: "two", teamName: "other", status: "active", leadSessionId: "other", members: [] }];
  for (const state of states) {
    const dir = path.join(store, "teams", "runtime", state.teamRunId);
    await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, "state.json"), JSON.stringify(state));
  }
  await mkdir(path.join(store, "teams", "runtime", "creating"));
  const incomplete = path.join(store, "teams", "runtime", "incomplete");
  await mkdir(incomplete); await writeFile(path.join(incomplete, "state.json"), '{"version":');
  expect(await readTeams(agent, cwd, "lead")).toEqual([{ id: "one", name: "owned", status: "active", members: [{ name: "worker", sessionId: "child", status: "idle", model: "local/test" }] }]);
  expect(await readFile(path.join(store, "teams", "runtime", "one", "state.json"), "utf8")).toBe(JSON.stringify(states[0]));
  expect(await readTeams(agent, cwd, "absent")).toEqual([]);
});
