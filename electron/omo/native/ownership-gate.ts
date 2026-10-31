import path from "node:path";
import type { ClientMethod, RpcNotification } from "../../../shared/protocol";
import type { SessionHolder } from "../../../shared/session-held";
import { SessionHolders } from "../session-holders";
import type { AppServerClientOptions } from "../app-server-client";
import { NativeConnection, NativeCommandError } from "./connection";
import { NativeOwnership } from "./ownership";
import type { OwnershipSnapshot, OwnershipTarget } from "./ownership";

/** These reads use disk only. Stats/fast-mode/export require load and may not attach while read-only. */
const READS: ReadonlySet<ClientMethod> = new Set(["thread/read", "thread/goal/get"]);
const STORAGE_MUTATIONS: ReadonlySet<ClientMethod> = new Set(["thread/delete", "thread/archive", "thread/unarchive"]);
export interface OwnershipGateOptions {
  client: AppServerClientOptions;
  ownPid(): number | null;
  /** The client's successful native open, not merely a matching socket, proves this attachment is ours. */
  attached?(threadId: string): boolean;
  target(threadId: string): Promise<OwnershipTarget | null>;
  open(threadId: string): Promise<void>;
  emit(notification: RpcNotification): void;
}
function sameSocket(left: string, right: string): boolean {
  const a = path.resolve(left), b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
/** Native admission also covers sidecar operations, which otherwise bypass the engine's RPC write gate. */
export class NativeOwnershipGate {
  private readonly holders: SessionHolders;
  private readonly ownership: NativeOwnership;
  private readonly observed = new Map<string, OwnershipSnapshot>();
  private hostInstance: string | null = null;
  constructor(private readonly options: OwnershipGateOptions) {
    this.holders = new SessionHolders({ ownPids: () => [process.pid, options.ownPid()], ttlMs: 0 });
    this.ownership = new NativeOwnership({
      holders: {
        lookup: async targets => this.foreign(targets),
        watch: (sessionPath, changed) => this.holders.watch(sessionPath, changed),
      },
      peer: socket => new NativeConnection({ command: options.client.command, args: [], cwd: options.client.cwd, env: options.client.env, socket }),
      open: target => options.open(target.id),
      changed: snapshot => {
        if (snapshot.writable) this.observed.delete(snapshot.id); else this.observed.set(snapshot.id, snapshot);
        this.options.emit({ method: "extension_event", params: { type: "extension_event", threadId: snapshot.id, name: "omo.session.ownership", data: { holders: snapshot.holders, writable: snapshot.writable } } });
      },
    });
  }
  /** Set only from get_protocol_info on the application's own connection. */
  identifyHost(instanceId: unknown): void {
    this.hostInstance = typeof instanceId === "string" ? instanceId : null;
  }
  private async foreign(targets: readonly OwnershipTarget[]): Promise<Record<string, SessionHolder[]>> {
    const holders = await this.holders.lookup(targets);
    for (const { id } of targets) {
      const remaining = holders[id]?.filter(holder => !(this.options.attached?.(id) === true
        && this.options.client.socket !== undefined
        && this.hostInstance !== null
        && holder.identity === "verified"
        && holder.hostInstance === this.hostInstance
        && holder.hostSocket !== undefined
        && sameSocket(holder.hostSocket, this.options.client.socket)));
      if (remaining?.length) holders[id] = remaining; else delete holders[id];
    }
    return holders;
  }
  async before(method: ClientMethod, input: Record<string, unknown>): Promise<void> {
    if (typeof input["threadId"] !== "string") return;
    const threadId = input["threadId"];
    // .54 has no atomic shared-host disk mutation API: caller-only close/unload cannot reserve
    // the file against another attachment or reopen. Keep these operations on a private runtime.
    if (STORAGE_MUTATIONS.has(method) && this.options.client.socket !== undefined) {
      throw new NativeCommandError(method, "Session storage changes require a private runtime. Turn off the shared host in Settings before archiving, restoring or deleting this session.", "exclusive_runtime_required", undefined);
    }
    // An already admitted handle is authoritative for native commands, even if CIM discovery
    // is unavailable. Native still checks foreign writers on every mutation, including Stop.
    if (this.options.attached?.(threadId) === true && !STORAGE_MUTATIONS.has(method)) return;
    const target = await this.options.target(threadId);
    if (target === null) return;
    const holders = (await this.foreign([target]))[threadId] ?? [];
    if (holders.length > 0 || this.observed.has(threadId)) {
      // Selecting history starts observation without first trying to attach or send a prompt.
      await this.ownership.observe(target);
      const current = this.observed.get(threadId);
      if (current !== undefined && !READS.has(method)) throw new NativeCommandError(method, "Session is held by another process", "session_held", { holders: current.holders });
    }
  }
  /** Start observation after a native race refusal, but never replay the refused mutation. */
  async refused(threadId: string, error: unknown): Promise<void> {
    if (!(error instanceof NativeCommandError) || error.errorCode !== "session_held") return;
    const target = await this.options.target(threadId);
    if (target !== null) await this.ownership.observe(target);
  }
  assertWritable(threadId: string): void {
    const current = this.observed.get(threadId);
    if (current !== undefined) throw new NativeCommandError("mutation", "Session is held by another process", "session_held", { holders: current.holders });
  }
  close(): void { this.ownership.close(); this.observed.clear(); }
}
