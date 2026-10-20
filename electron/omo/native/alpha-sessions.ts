import { readFileSync } from "node:fs";
import path from "node:path";
import { ENV } from "../../../shared/ipc";

/**
 * OmO (Alpha)'s session stores, listed beside omo's own sessions so threads started in Alpha can be imported and
 * opened here. Alpha keeps its data home at `~/.omo/desktop` unless `omo-data-home.json` there points elsewhere;
 * its omo sessions live in `<home>/userdata/omo-sessions/<runtime>/thread-<id>-*.jsonl`.
 *
 * An isolated QA agent dir never sees the owner's Alpha store unless the run names one through `OMO_UI_ALPHA_HOME`.
 */
export function alphaSessionRoots(homeDir: string, env: Readonly<Record<string, string | undefined>>): string[] {
  const explicit = env[ENV.alphaHome];
  if (explicit === "") return [];
  if (explicit === undefined && env[ENV.qaAgentDir] !== undefined) return [];
  const home = explicit ?? pointedHome(path.join(homeDir, ".omo", "desktop"));
  return [path.join(home, "userdata", "omo-sessions")];
}

function pointedHome(defaultHome: string): string {
  try {
    const pointer: unknown = JSON.parse(readFileSync(path.join(defaultHome, "omo-data-home.json"), "utf8"));
    if (typeof pointer === "object" && pointer !== null) {
      const target = (pointer as Record<string, unknown>)["path"];
      if (typeof target === "string" && path.isAbsolute(target)) return target;
    }
  } catch {
    // No pointer, or one that does not parse: Alpha's home is the default folder.
  }
  return defaultHome;
}
