import path from "node:path";
import type { SessionHolders } from "../session-holders";
import type { SessionHolder } from "../../../shared/session-held";

interface RecordValue { [key: string]: unknown }
export interface OwnershipPeer {
  start(): void;
  send(command: string, fields: RecordValue, timeoutMs: number): Promise<unknown>;
  onRecord(listener: (record: RecordValue & { type: string }) => void): () => void;
  onExit?(listener: () => void): () => void;
  stop(timeouts: { afterStdinEnd: number; afterSigterm: number }): Promise<void>;
}
export interface OwnershipTarget { id: string; sessionPath: string }
export interface OwnershipSnapshot extends OwnershipTarget { holders: SessionHolder[]; writable: boolean }
export interface OwnershipOptions {
  holders: Pick<SessionHolders, "lookup" | "watch">;
  peer(socket: string): OwnershipPeer;
  /** Native open success is the only authority that promotes a session to writable. Never send input here. */
  open(target: OwnershipTarget): Promise<void>;
  changed(snapshot: OwnershipSnapshot): void;
}
function record(value: unknown): RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : {};
}
function samePath(a: unknown, b: string): boolean {
  if (typeof a !== "string") return false;
  const left = path.resolve(a), right = path.resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
const peerKey = (holder: SessionHolder): string => JSON.stringify([holder.pid, holder.processStartedAtMs, holder.hostSocket, holder.hostInstance]);
interface Observation {
  target: OwnershipTarget;
  holders: SessionHolder[];
  closed: boolean;
  running: Promise<void> | null;
  promoting: Promise<void> | null;
  again: boolean;
  unwatch: () => void;
  peer: OwnershipPeer | null;
  peerKey: string | null;
  unsubscribers: Array<() => void>;
}
/** Foreign-writer observation; no lease/fence edits, attachments, interruption or foreign process signals. */
export class NativeOwnership {
  private readonly observations = new Map<string, Observation>();
  private readonly checking = new Set<Observation>();
  private readonly checkAgain = new Set<Observation>();
  constructor(private readonly options: OwnershipOptions) {}
  /** Subscribe before lookup so release during discovery is not missed. */
  observe(target: OwnershipTarget): Promise<void> {
    const existing = this.observations.get(target.id);
    if (existing !== undefined && samePath(existing.target.sessionPath, target.sessionPath)) return this.refresh(existing);
    if (existing !== undefined) this.forget(target.id);
    const observation: Observation = { target, holders: [], closed: false, running: null, promoting: null, again: false, unwatch: () => {}, peer: null, peerKey: null, unsubscribers: [] };
    this.observations.set(target.id, observation);
    observation.unwatch = this.options.holders.watch(target.sessionPath, () => { void this.refresh(observation).catch(() => {}); });
    return this.refresh(observation);
  }
  assertWritable(threadId: string): void {
    const observation = this.observations.get(threadId);
    if (observation !== undefined) throw new Error(`session_held:${JSON.stringify({ holders: observation.holders })}`);
  }
  forget(threadId: string): void {
    const observation = this.observations.get(threadId);
    if (observation === undefined) return;
    observation.closed = true;
    observation.unwatch();
    this.dropPeer(observation);
    this.observations.delete(threadId);
  }
  close(): void { for (const id of this.observations.keys()) this.forget(id); }
  private dropPeer(observation: Observation): void {
    for (const unsubscribe of observation.unsubscribers.splice(0)) unsubscribe();
    const peer = observation.peer;
    observation.peer = null;
    observation.peerKey = null;
    if (peer !== null) void peer.stop({ afterStdinEnd: 1000, afterSigterm: 0 }).catch(() => {});
  }
  private refresh(observation: Observation): Promise<void> {
    if (observation.closed) return Promise.resolve();
    if (observation.running !== null) { observation.again = true; return observation.running; }
    const run = (async () => {
      do {
        observation.again = false;
        await this.refreshOnce(observation);
      } while (observation.again && !observation.closed);
    })();
    observation.running = run;
    void run.finally(() => { if (observation.running === run) observation.running = null; }).catch(() => {});
    return run;
  }
  private async refreshOnce(observation: Observation): Promise<void> {
    const { target } = observation;
    const holders = (await this.options.holders.lookup([target]))[target.id] ?? [];
    if (observation.closed) return;
    observation.holders = holders;
    this.options.changed({ ...target, holders, writable: false });
    if (holders.length === 0) { await this.tryOpen(observation); return; }
    const holder = holders.length === 1 ? holders[0] : undefined;
    if (observation.peer !== null && (holder === undefined || observation.peerKey !== peerKey(holder))) this.dropPeer(observation);
    if (holder === undefined || holder.identity !== "verified" || holder.hostSocket === undefined || holder.hostInstance === undefined || holder.endpointKind === "tui") return;
    if (observation.peer !== null) return;
    const peer = this.options.peer(holder.hostSocket);
    observation.peer = peer;
    observation.peerKey = peerKey(holder);
    let keep = false;
    try {
      peer.start();
      const info = record(await peer.send("get_protocol_info", { observe: true }, 5000));
      const capabilities = Array.isArray(info["capabilities"]) ? info["capabilities"] : [];
      if (observation.closed || info["mode"] !== "multi" || info["instanceId"] !== holder.hostInstance || !["expected_host_instance", "session_status", "release_caller_aware"].every(capability => capabilities.includes(capability))) return;
      holder.endpointKind = "rpc_host";
      let subscriptionId: string | null = null;
      observation.unsubscribers.push(peer.onRecord(event => {
        if (!observation.closed && event.type === "session_status" && event["subscriptionId"] === subscriptionId && event["durableSessionId"] === target.id) {
          void this.checkPeer(observation, peer, holder).catch(() => {});
        }
      }));
      if (peer.onExit !== undefined) observation.unsubscribers.push(peer.onExit(() => {
        if (observation.closed || observation.peer !== peer) return;
        this.dropPeer(observation);
        // A lost socket is not a dead owner. A fresh process/lease query still decides admission.
        void this.refresh(observation).catch(() => {});
      }));
      const subscription = record(await peer.send("subscribe_sessions", { sessions: { ids: [target.id] }, include_workers: true, mirror: "none", effects: false, observe: true }, 5000));
      if (observation.closed || subscription["hostInstanceId"] !== holder.hostInstance || typeof subscription["subscriptionId"] !== "string") return;
      subscriptionId = subscription["subscriptionId"];
      keep = true;
      await this.checkPeer(observation, peer, holder);
    } catch {
      // Unavailable, busy and replaced endpoints keep the session read-only.
    } finally {
      if ((!keep || observation.closed) && observation.peer === peer) this.dropPeer(observation);
    }
  }
  private async checkPeer(observation: Observation, peer: OwnershipPeer, holder: SessionHolder): Promise<void> {
    if (observation.closed || observation.peer !== peer) return;
    if (this.checking.has(observation)) { this.checkAgain.add(observation); return; }
    this.checking.add(observation);
    try {
      do {
        this.checkAgain.delete(observation);
        const listed = record(await peer.send("list_sessions", { include_workers: true, observe: true }, 5000));
        if (observation.closed || observation.peer !== peer) return;
        const rows = Array.isArray(listed["sessions"]) ? listed["sessions"].map(record) : [];
        const row = rows.find(value => value["durableSessionId"] === observation.target.id && samePath(value["sessionPath"], observation.target.sessionPath));
        if (row === undefined) { await this.tryOpen(observation); return; }
        if (row["attachments"] !== 0 || row["status"] !== "open" || row["retain_on_disconnect"] !== true || typeof row["sessionId"] !== "string") continue;
        const current = (await this.options.holders.lookup([observation.target]))[observation.target.id] ?? [];
        if (current.length !== 1 || current[0]?.identity !== "verified" || peerKey(current[0]) !== peerKey(holder)) return;
        const info = record(await peer.send("get_protocol_info", { observe: true }, 5000));
        if (observation.closed || observation.peer !== peer || info["instanceId"] !== holder.hostInstance) return;
        // .54 allows observer release; native atomically checks all busy signals and other attachments.
        // It warns that unattached release will be refused in the next release; do not force or interrupt.
        const released = record(await peer.send("release_session", { sessionId: row["sessionId"], reason: "takeover" }, 15000));
        if (released["released"] === true && samePath(released["session_path"], observation.target.sessionPath)) await this.tryOpen(observation);
      } while (this.checkAgain.has(observation) && !observation.closed);
    } finally { this.checking.delete(observation); this.checkAgain.delete(observation); }
  }
  private tryOpen(observation: Observation): Promise<void> {
    if (observation.closed) return Promise.resolve();
    if (observation.promoting !== null) return observation.promoting;
    const pending = (async () => {
      try {
        await this.options.open(observation.target);
        if (observation.closed) return;
        this.options.changed({ ...observation.target, holders: [], writable: true });
        this.forget(observation.target.id);
      } catch { /* Another writer may have won. Native refusal keeps the observation read-only. */ }
    })();
    observation.promoting = pending;
    void pending.finally(() => { if (observation.promoting === pending) observation.promoting = null; });
    return pending;
  }
}
