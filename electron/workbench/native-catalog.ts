import { spawn } from "node:child_process";
import type { NativeCatalog, NativeCommand } from "../../shared/workbench";
import type { SpawnImpl } from "../omo/app-server-client";
import { JsonlDecoder } from "../omo/jsonl";
import { ManagedChild } from "../omo/managed-child";
import { scrubChildEnv } from "../omo/shell-env";
import { workspace } from "./validation";

interface CatalogDeps {
  supervisor: {
    getStatus: () => { omo: { path: string } | null };
    getLoginEnv: () => Promise<Record<string, string>>;
  };
  spawnImpl?: SpawnImpl;
  timeoutMs?: number;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function catalog(commandsData: unknown, modelsData: unknown): NativeCatalog {
  if (!object(commandsData) || !Array.isArray(commandsData["commands"]) || !object(modelsData) || !Array.isArray(modelsData["models"])) {
    throw new Error("omo returned a malformed native catalog response");
  }
  const commands: NativeCommand[] = [];
  for (const row of commandsData["commands"]) {
    if (!object(row) || typeof row["name"] !== "string" ||
      (row["source"] !== "extension" && row["source"] !== "prompt" && row["source"] !== "skill") ||
      (row["syntax"] !== "slash" && row["syntax"] !== "dollar")) continue;
    commands.push({ name: row["name"], description: typeof row["description"] === "string" ? row["description"] : "", source: row["source"], syntax: row["syntax"] });
  }
  const contextWindows: Record<string, number> = {};
  for (const row of modelsData["models"]) {
    if (!object(row) || typeof row["id"] !== "string" || typeof row["provider"] !== "string" ||
      typeof row["contextWindow"] !== "number" || !Number.isSafeInteger(row["contextWindow"]) || row["contextWindow"] <= 0) continue;
    contextWindows[`${row["provider"]}/${row["id"]}`] = row["contextWindow"];
  }
  return { commands, contextWindows, error: null };
}

async function query(deps: CatalogDeps, cwd: string): Promise<NativeCatalog> {
  const binary = deps.supervisor.getStatus().omo?.path;
  if (!binary) throw new Error("omo binary is unavailable");
  const env = scrubChildEnv(await deps.supervisor.getLoginEnv());
  const args = ["--mode", "rpc", "--no-session", "--offline"];
  const nodeScript = process.platform === "win32" && /\.mjs$/iu.test(binary);
  const processChild = (deps.spawnImpl ?? spawn)(nodeScript ? process.execPath : binary, nodeScript ? [binary, ...args] : args, {
    cwd, env: nodeScript ? { ...env, ELECTRON_RUN_AS_NODE: "1" } : env, stdio: "pipe", windowsHide: true,
  });
  let rejectResponse: (error: Error) => void = () => undefined;
  const child = new ManagedChild(processChild, (code, signal) => {
    rejectResponse(child.spawnError ?? new Error(`omo native catalog exited (${signal ?? code})`));
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    return await new Promise<NativeCatalog>((resolve, reject) => {
      rejectResponse = reject;
      const responses = new Map<string, unknown>();
      const decoder = new JsonlDecoder({
        onFrame: (frame) => {
          if (!object(frame) || frame["type"] !== "response" || (frame["id"] !== "c1" && frame["id"] !== "m1")) return;
          if (frame["success"] !== true) {
            reject(new Error(typeof frame["error"] === "string" ? frame["error"] : "omo native catalog request failed"));
            return;
          }
          responses.set(frame["id"], frame["data"]);
          if (responses.size === 2) {
            try { resolve(catalog(responses.get("c1"), responses.get("m1"))); }
            catch (error) { reject(error); }
          }
        },
        onMalformed: (_line, error) => reject(error),
      });
      processChild.stdout.on("data", (chunk: Buffer) => decoder.push(chunk));
      processChild.stdout.on("end", () => decoder.end());
      processChild.stdin.on("error", reject);
      timer = setTimeout(() => reject(new Error("omo native catalog timed out")), deps.timeoutMs ?? 30_000);
      processChild.stdin.write('{"id":"c1","type":"get_commands"}\n{"id":"m1","type":"get_available_models"}\n');
    });
  } finally {
    clearTimeout(timer);
    await child.stop({ afterStdinEnd: 1_000, afterSigterm: 1_000 });
  }
}

export function createNativeCatalog(deps: CatalogDeps): (cwd: unknown, force?: boolean) => Promise<NativeCatalog> {
  const cache = new Map<string, NativeCatalog>();
  const inflight = new Map<string, Promise<NativeCatalog>>();
  const failure = (error: unknown): NativeCatalog => ({ commands: [], contextWindows: {}, error: error instanceof Error ? error.message : String(error) });
  return async (requested, force = false) => {
    let cwd: string;
    try { cwd = await workspace(requested); }
    catch (error) { return failure(error); }
    const pending = inflight.get(cwd);
    if (pending) return pending;
    const cached = cache.get(cwd);
    if (!force && cached) return cached;
    const promise = query(deps, cwd).catch(failure).then((result) => {
      cache.set(cwd, result);
      return result;
    }).finally(() => inflight.delete(cwd));
    inflight.set(cwd, promise);
    return promise;
  };
}
