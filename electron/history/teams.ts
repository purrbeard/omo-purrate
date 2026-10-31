import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { TeamSnapshot } from "../../shared/team";
import { taskStore } from "./task-work";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** .54 teams/runtime/<run>/state.json, filtered by the authoritative lead session. */
export async function readTeams(agentDir: string, cwd: string, threadId: string): Promise<TeamSnapshot[]> {
  const directory = path.join(await taskStore(agentDir, cwd), "teams", "runtime");
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw new Error("Could not read team inventory");
  }
  const result: TeamSnapshot[] = [];
  const resolvedDirectory = await realpath(directory);
  const store = await realpath(await taskStore(agentDir, cwd));
  const within = path.relative(store, resolvedDirectory);
  if (within === ".." || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)) throw new Error("Linked team directories are not supported");
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name, "state.json");
    let value: unknown;
    try {
      if ((await lstat(file)).isSymbolicLink()) throw new Error("Linked team states are not supported");
      value = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      // Team creation and atomic replacement can leave a missing or incomplete state during a directory scan.
      if (error instanceof SyntaxError || (error instanceof Error && "code" in error && error.code === "ENOENT")) continue;
      throw error;
    }
    if (!object(value) || value["leadSessionId"] !== threadId) continue;
    if (value["version"] !== 1 || value["teamRunId"] !== entry.name || typeof value["teamName"] !== "string" || typeof value["status"] !== "string" || !Array.isArray(value["members"])) throw new Error("Invalid team state");
    const members = value["members"].map((member: unknown) => {
      if (!object(member) || typeof member["name"] !== "string" || typeof member["status"] !== "string") throw new Error("Invalid team member");
      const model = member["model"];
      return { name: member["name"], status: member["status"], sessionId: typeof member["sessionId"] === "string" ? member["sessionId"] : null,
        model: object(model) && typeof model["providerID"] === "string" && typeof model["modelID"] === "string" ? `${model["providerID"]}/${model["modelID"]}` : null };
    });
    result.push({ id: entry.name, name: value["teamName"], status: value["status"], members });
  }
  return result;
}
