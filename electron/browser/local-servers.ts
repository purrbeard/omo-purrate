import { execFile } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";
import type { LocalServer } from "../../shared/browser";

const exec = promisify(execFile);
const PROBE_TIMEOUT_MS = 1_000;

/** Ports dev servers commonly use: 3000-5999, 8000-8999, Tauri's 1420 and Storybook's 6006. */
export function isDevPort(port: number): boolean {
  return (port >= 3000 && port <= 5999) || (port >= 8000 && port <= 8999) || port === 1420 || port === 6006;
}

export interface Listener {
  port: number;
  pid: number | null;
  /** The loopback or wildcard address the socket is bound to, as the probe host. */
  host: string;
}

/**
 * Listening TCP sockets in `netstat -ano` output. A listening socket's foreign address is the wildcard `*:0`, which
 * keeps the parse independent of the localized state column. Only loopback and wildcard binds are kept.
 */
export function parseNetstat(text: string): Listener[] {
  const found = new Map<number, Listener>();
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4 || parts[0]?.toUpperCase() !== "TCP") continue;
    const [, local = "", foreign = ""] = parts;
    if (foreign !== "0.0.0.0:0" && foreign !== "[::]:0" && foreign !== "*:*") continue;
    const split = local.lastIndexOf(":");
    const address = local.slice(0, split);
    const port = Number(local.slice(split + 1));
    if (!Number.isInteger(port) || !isDevPort(port)) continue;
    const host = address === "127.0.0.1" || address === "0.0.0.0" ? "127.0.0.1" : address === "[::1]" || address === "[::]" ? "::1" : null;
    if (host === null || found.has(port)) continue;
    const pid = Number(parts.at(-1));
    found.set(port, { port, pid: Number.isInteger(pid) && pid > 0 ? pid : null, host });
  }
  return [...found.values()].sort((a, b) => a.port - b.port);
}

/** Listening sockets from `lsof -nP -iTCP -sTCP:LISTEN` (macOS and Linux). */
export function parseLsof(text: string): Listener[] {
  const found = new Map<number, Listener>();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const parts = line.trim().split(/\s+/);
    // NAME is the column before "(LISTEN)", e.g. `127.0.0.1:5173`.
    const name = parts.at(-2) ?? "";
    const match = /^(.*):(\d+)$/.exec(name);
    if (match === null) continue;
    const port = Number(match[2]);
    const address = match[1] ?? "";
    if (!isDevPort(port) || found.has(port)) continue;
    const host = address === "*" || address === "127.0.0.1" || address === "localhost" ? "127.0.0.1" : address === "[::1]" ? "::1" : null;
    if (host === null) continue;
    const pid = Number(parts[1]);
    found.set(port, { port, pid: Number.isInteger(pid) ? pid : null, host });
  }
  return [...found.values()].sort((a, b) => a.port - b.port);
}

/** @returns the HTTP status of a HEAD request, or null when nothing answers within a second */
export function probeHead(host: string, port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const request = http.request({ host, port, method: "HEAD", path: "/", timeout: PROBE_TIMEOUT_MS }, (response) => {
      response.resume();
      resolve(response.statusCode ?? null);
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(null));
    request.end();
  });
}

async function listeners(): Promise<Listener[]> {
  if (process.platform === "win32") {
    // `-p tcp` lists IPv4 only; dev servers bound to `localhost` often listen on ::1 alone.
    const outputs = await Promise.all(["tcp", "tcpv6"].map((protocol) =>
      exec("netstat", ["-ano", "-p", protocol], { windowsHide: true, timeout: 5_000 }).then(({ stdout }) => stdout)));
    return parseNetstat(outputs.join("\n"));
  }
  const { stdout } = await exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], { timeout: 5_000 });
  return parseLsof(stdout);
}

export async function listLocalServers(): Promise<LocalServer[]> {
  const found = await listeners();
  const servers = await Promise.all(found.map(async ({ port, pid, host }) => ({
    port, pid, url: `http://localhost:${port}/`, status: await probeHead(host, port),
  })));
  // Servers that answer come first; silent listeners (often not HTTP) follow, each group by port.
  return servers.sort((a, b) => Number(a.status === null) - Number(b.status === null) || a.port - b.port);
}
