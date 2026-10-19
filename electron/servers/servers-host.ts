import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SshHost, SshHostState, SshInventory } from "../../shared/servers";
import { createLimiter, probeSpecs, testConnection } from "./probe";
import type { ProbeResult, RunSsh } from "./probe";
import { parseSshConfig } from "./ssh-config";

const MAX_PARALLEL_PROBES = 3;

export interface ServersHostDeps {
  configPath: string;
  /** userData/ssh-hosts.json: the last state per alias, specs included. */
  cacheFile: string;
  run: RunSsh;
  send(state: SshHostState): void;
  now?: () => number;
}

type Cached = Omit<SshHostState, "probing">;

function readCache(file: string): Record<string, Cached> {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    const hosts = typeof value === "object" && value !== null ? (value as { hosts?: unknown }).hosts : null;
    return typeof hosts === "object" && hosts !== null ? hosts as Record<string, Cached> : {};
  } catch { return {}; }
}

/**
 * The servers dock's main side: reads the ssh config (never writes it), probes hosts at most three at a time and
 * keeps each host's last result in userData. Only aliases from the config are probed.
 */
export class ServersHost {
  private hosts: SshHost[] = [];
  private cache: Record<string, Cached>;
  private readonly probing = new Map<string, Promise<SshHostState>>();
  private readonly limit = createLimiter(MAX_PARALLEL_PROBES);
  private readonly now: () => number;

  constructor(private readonly deps: ServersHostDeps) {
    this.cache = readCache(deps.cacheFile);
    this.now = deps.now ?? Date.now;
  }

  list(): SshInventory {
    let text: string;
    try {
      text = readFileSync(this.deps.configPath, "utf8");
    } catch (error) {
      this.hosts = [];
      const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
      return { configPath: this.deps.configPath, hosts: [], states: {}, error: code === "ENOENT" ? "not-found" : String(error) };
    }
    this.hosts = parseSshConfig(text, { sshDir: path.dirname(this.deps.configPath) });
    const states = Object.fromEntries(this.hosts.flatMap((host) => {
      const state = this.state(host.alias);
      return state.checkedAt === null && !state.probing ? [] : [[host.alias, state]];
    }));
    return { configPath: this.deps.configPath, hosts: this.hosts, states, error: null };
  }

  test(alias: unknown): Promise<SshHostState> {
    return this.queue(this.known(alias), "test");
  }

  refresh(alias: unknown): Promise<SshHostState> {
    return this.queue(this.known(alias), "specs");
  }

  private known(alias: unknown): string {
    if (this.hosts.length === 0) this.list();
    if (typeof alias !== "string" || !this.hosts.some((host) => host.alias === alias)) throw new Error("Unknown ssh host");
    return alias;
  }

  private state(alias: string): SshHostState {
    const cached = this.cache[alias];
    return {
      alias, status: cached?.status ?? "unknown", latencyMs: cached?.latencyMs ?? null, checkedAt: cached?.checkedAt ?? null,
      message: cached?.message ?? null, specs: cached?.specs ?? null, specsAt: cached?.specsAt ?? null, probing: this.probing.has(alias),
    };
  }

  /** One probe per host at a time; a request while one runs waits for that one. */
  private queue(alias: string, kind: "test" | "specs"): Promise<SshHostState> {
    const running = this.probing.get(alias);
    if (running !== undefined) return running;
    const work = this.limit(() => (kind === "test" ? testConnection : probeSpecs)(this.deps.run, alias))
      .then((result) => { this.record(alias, result, kind); })
      .finally(() => {
        this.probing.delete(alias);
        this.deps.send(this.state(alias));
      })
      .then(() => this.state(alias));
    this.probing.set(alias, work);
    this.deps.send(this.state(alias));
    return work;
  }

  private record(alias: string, result: ProbeResult, kind: "test" | "specs"): void {
    const previous = this.cache[alias];
    const at = this.now();
    const keepSpecs = kind === "test" || result.specs === null;
    this.cache[alias] = {
      alias, status: result.status, latencyMs: result.latencyMs, checkedAt: at, message: result.message,
      specs: keepSpecs ? previous?.specs ?? null : result.specs, specsAt: keepSpecs ? previous?.specsAt ?? null : at,
    };
    this.save();
  }

  private save(): void {
    mkdirSync(path.dirname(this.deps.cacheFile), { recursive: true });
    const temp = `${this.deps.cacheFile}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ version: 1, hosts: this.cache }, null, 2)}\n`, "utf8");
    renameSync(temp, this.deps.cacheFile);
  }
}
