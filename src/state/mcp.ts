import type { McpTool } from "../../shared/protocol";
import { object } from "./live-wire";

export interface McpServer {
  name: string;
  serverInfo: { name: string; version: string } | null;
  tools: McpTool[];
  authStatus: string;
  status?: string;
}

/** Validate at the RPC boundary; discard malformed entries, not forward-compatible statuses. */
export function normalizeMcpPage(value: unknown): { servers: McpServer[]; nextCursor: string | null } {
  if (!object(value) || !Array.isArray(value["data"]) ||
      !(value["nextCursor"] === null || typeof value["nextCursor"] === "string")) {
    throw new Error("omo returned a malformed mcpServerStatus/list result");
  }
  const servers: McpServer[] = [];
  for (const entry of value["data"]) {
    if (!object(entry) || typeof entry["name"] !== "string" || typeof entry["authStatus"] !== "string" ||
        !object(entry["tools"]) || !Array.isArray(entry["resources"]) || !Array.isArray(entry["resourceTemplates"]) ||
        (entry["status"] !== undefined && typeof entry["status"] !== "string")) continue;
    const info = entry["serverInfo"];
    if (info !== null && (!object(info) || typeof info["name"] !== "string" || typeof info["version"] !== "string")) continue;
    const tools: McpTool[] = [];
    for (const tool of Object.values(entry["tools"])) {
      if (!object(tool) || typeof tool["name"] !== "string" ||
          (tool["description"] !== undefined && typeof tool["description"] !== "string") ||
          (tool["title"] !== undefined && typeof tool["title"] !== "string")) continue;
      tools.push({ name: tool["name"], ...(typeof tool["description"] === "string" ? { description: tool["description"] } : {}) });
    }
    servers.push({ name: entry["name"], authStatus: entry["authStatus"],
      serverInfo: info === null ? null : { name: String(info["name"]), version: String(info["version"]) },
      tools: tools.sort((a, b) => a.name.localeCompare(b.name)),
      ...(typeof entry["status"] === "string" ? { status: entry["status"] } : {}) });
  }
  return { servers, nextCursor: value["nextCursor"] };
}

/** Match omo's status precedence; unsupported authentication alone does not mean disabled. */
export function mcpDisplayStatus(server: McpServer): string {
  return server.status ?? (server.serverInfo !== null ? "connected" : server.authStatus === "notLoggedIn" ? "needs_auth" : "enabled");
}
