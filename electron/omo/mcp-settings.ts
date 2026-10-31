import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { McpSaveInput, McpScope, McpServerType, McpSnapshot } from "../../shared/mcp-settings";
import { rename } from "node:fs/promises";

type RecordValue = Record<string, unknown>;

function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new Error("Invalid MCP configuration or input.");
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function fileFor(scope: McpScope, agentDir: string, cwd: string): string {
  if (scope === "global") return path.join(agentDir, "mcp.json");
  if (scope === "project") return path.join(cwd, ".omo", "mcp.json");
  return invalid();
}

async function readOptional(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}

function parse(bytes: Buffer | undefined): RecordValue {
  if (bytes === undefined) return {};
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    return invalid();
  }
  if (!record(value)) return invalid();
  if (value["mcpServers"] !== undefined && !record(value["mcpServers"])) return invalid();
  return value;
}

function servers(config: RecordValue): RecordValue {
  const value = config["mcpServers"];
  if (value === undefined) return {};
  if (!record(value)) return invalid();
  return value;
}

function serverType(entry: RecordValue): McpServerType {
  const type = entry["type"] ?? (entry["url"] !== undefined ? "http" : "stdio");
  if (type !== "stdio" && type !== "http") return invalid();
  return type;
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !/[\0\r\n]/.test(value);
}

function validate(input: unknown): asserts input is McpSaveInput {
  if (!record(input)) return invalid();
  const allowed = new Set(["revision", "mode", "name", "type", "enabled", "command", "args", "url", "remove"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) return invalid();
  if (typeof input["revision"] !== "string" || (input["mode"] !== "create" && input["mode"] !== "update")) return invalid();
  if (!validText(input["name"]) || input["name"] !== input["name"].trim()) return invalid();
  if (input["type"] !== "stdio" && input["type"] !== "http") return invalid();
  if (typeof input["enabled"] !== "boolean") return invalid();
  if (input["remove"] !== undefined && typeof input["remove"] !== "boolean") return invalid();
  if (input["command"] !== undefined && !validText(input["command"])) return invalid();
  if (input["args"] !== undefined &&
      (!Array.isArray(input["args"]) ||
       input["args"].some((arg: unknown) => typeof arg !== "string" || /[\0\r\n]/.test(arg)))) return invalid();
  if (input["url"] !== undefined) {
    if (!validText(input["url"]) || /\s/.test(input["url"])) return invalid();
    let url: URL;
    try {
      url = new URL(input["url"]);
    } catch {
      return invalid();
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") ||
        !url.hostname || url.username || url.password || url.search || url.hash) return invalid();
  }
  if (input["type"] === "stdio" && input["url"] !== undefined) return invalid();
  if (input["type"] === "http" &&
      (input["command"] !== undefined || input["args"] !== undefined)) return invalid();
}

function same(a: Buffer | undefined, b: Buffer | undefined): boolean {
  return a === undefined ? b === undefined : b !== undefined && a.equals(b);
}

function revision(file: string, bytes: Buffer | undefined): string {
  return createHash("sha256").update(file).update("\0").update(bytes === undefined ? "missing" : "present").update(bytes ?? "").digest("hex");
}

/** Returns metadata only. Never return the parsed configuration to the renderer. */
export async function loadMcpSettings(
  scope: McpScope,
  agentDir: string,
  cwd: string,
): Promise<McpSnapshot> {
  try {
    const file = fileFor(scope, agentDir, cwd);
    const bytes = await readOptional(file);
    const config = parse(bytes);
    return { revision: revision(file, bytes), servers: Object.entries(servers(config)).map(([name, value]) => {
      if (!record(value)) return invalid();
      if (value["enabled"] !== undefined && typeof value["enabled"] !== "boolean") return invalid();
      return { name, type: serverType(value), enabled: value["enabled"] !== false };
    }) };
  } catch {
    throw new Error("Could not read MCP configuration.");
  }
}

/**
 * Updates one entry without resolving or exposing existing values.
 * The caller must serialize writes in this process. A re-read detects ordinary
 * external changes but is not an atomic cross-process compare-and-swap.
 */
export async function saveMcpSettings(
  scope: McpScope,
  agentDir: string,
  cwd: string,
  input: unknown,
): Promise<void> {
  try {
    validate(input);
    const file = fileFor(scope, agentDir, cwd);
    const original = await readOptional(file);
    if (input.revision !== revision(file, original)) throw new Error("MCP configuration changed since it was loaded.");
    const config = parse(original);
    const entries = servers(config);
    const exists = Object.hasOwn(entries, input.name);
    if ((input.mode === "create" && exists) || (input.mode === "update" && !exists) || (input.remove && input.mode !== "update")) return invalid();
    const old = exists ? entries[input.name] : undefined;
    if (exists && !record(old)) return invalid();
    if (record(old) && serverType(old) !== input.type) return invalid();
    if (!exists && (input.remove || input.type === "stdio" && input.command === undefined || input.type === "http" && input.url === undefined)) return invalid();

    const entry: RecordValue = record(old) ? { ...old } : {};
    entry["type"] = input.type;
    entry["enabled"] = input.enabled;
    if (input.command !== undefined) entry["command"] = input.command;
    if (input.args !== undefined) entry["args"] = input.args;
    if (input.url !== undefined) entry["url"] = input.url;
    const nextEntries = { ...entries };
    Object.defineProperty(nextEntries, input.name, {
      value: entry, enumerable: true, configurable: true, writable: true,
    });
    if (input.remove) delete nextEntries[input.name];
    const next = Buffer.from(`${JSON.stringify({ ...config, mcpServers: nextEntries }, null, 2)}\n`, "utf8");

    if (same(original, next)) return;
    await mkdir(path.dirname(file), { recursive: true });
    const mode = original === undefined ? 0o600 : (await stat(file)).mode & 0o777;
    const stagedPath = `${file}.${randomUUID()}.tmp`;
    const staged = await open(stagedPath, "wx", mode);
    try {
      await staged.writeFile(next);
      await staged.sync();
    } finally {
      await staged.close();
    }
    if (!same(original, await readOptional(file))) {
      throw new Error("MCP configuration changed while saving.");
    }
    if (original !== undefined) {
      const backup = await open(`${file}.${randomUUID()}.bak`, "wx", mode);
      try {
        await backup.writeFile(original);
        await backup.sync();
      } finally {
        await backup.close();
      }
    }
    if (!same(original, await readOptional(file))) {
      throw new Error("MCP configuration changed while saving.");
    }
    await rename(stagedPath, file);
  } catch {
    // Never forward file paths, input values, parser errors, or OS error text.
    throw new Error("Could not save MCP configuration. Check input and retry after reloading.");
  }
}
