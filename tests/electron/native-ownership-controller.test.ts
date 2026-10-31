import { describe, expect, it, vi } from "vitest";
import { NativeOwnership } from "../../electron/omo/native/ownership";
import type { OwnershipPeer, OwnershipSnapshot } from "../../electron/omo/native/ownership";
import type { SessionHolders } from "../../electron/omo/session-holders";
import type { SessionHolder } from "../../shared/session-held";

const target = { id: "foreign", sessionPath: "P:\\sessions\\foreign.jsonl" };
const holder: SessionHolder = { pid: 123, processStartedAtMs: 1000, identity: "verified", hostSocket: "P:\\rpc\\host.sock", hostInstance: "instance-1" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("ownership signal did not arrive")), 1000); })]);
  } finally { clearTimeout(timer); }
}
function fixture(initial: SessionHolder[] = [holder]) {
  let holders = initial;
  let changed = () => {};
  let emit = (_record: Record<string, unknown> & { type: string }) => {};
  const frames: Array<{ command: string; fields: Record<string, unknown> }> = [];
  let row: Record<string, unknown> | null = { sessionId: "rpc-foreign", durableSessionId: target.id, sessionPath: target.sessionPath, status: "open", attachments: 0, retain_on_disconnect: true };
  let instance = "instance-1";
  let release: () => Promise<unknown> = async () => ({ released: true, session_path: target.sessionPath });
  const list = vi.fn(async (): Promise<unknown> => ({ sessions: row === null ? [] : [row] }));
  const peer: OwnershipPeer = {
    start: vi.fn(), stop: vi.fn(async () => {}),
    onRecord: listener => { emit = listener; return () => { emit = () => {}; }; },
    async send(command, fields) {
      frames.push({ command, fields });
      if (command === "get_protocol_info") return { mode: "multi", instanceId: instance, capabilities: ["expected_host_instance", "session_status", "release_caller_aware"] };
      if (command === "subscribe_sessions") return { hostInstanceId: instance, subscriptionId: "sub-1", seq: 0, snapshot: [] };
      if (command === "list_sessions") return list();
      if (command === "release_session") return release();
      throw new Error(`unexpected ${command}`);
    },
  };
  const snapshots: OwnershipSnapshot[] = [];
  const promoted = deferred<void>();
  const opened = deferred<void>();
  const open = vi.fn(async () => { opened.resolve(); });
  const lookup = vi.fn(async () => ({ [target.id]: holders }));
  const lease: Pick<SessionHolders, "lookup" | "watch"> = { lookup, watch: vi.fn((_path, callback) => { changed = callback; return vi.fn(); }) };
  const controller = new NativeOwnership({ holders: lease, peer: () => peer, open, changed: snapshot => { snapshots.push(snapshot); if (snapshot.writable) promoted.resolve(); } });
  return { controller, frames, snapshots, open, opened, promoted, peer, lookup, lease, list,
    setHolders(value: SessionHolder[]) { holders = value; },
    setRow(value: Record<string, unknown> | null) { row = value; },
    setInstance(value: string) { instance = value; },
    setRelease(value: () => Promise<unknown>) { release = value; },
    edge() { changed(); },
    status(subscriptionId = "sub-1", durableSessionId = target.id) { emit({ type: "session_status", subscriptionId, seq: 1, durableSessionId, sessionId: "rpc-foreign", status: "closed", cause: "session_closed" }); },
  };
}

describe("NativeOwnership cooperative transition", () => {
  it("observes without attachment, releases only quiet retained ownership, and unlocks only after native open", async () => {
    const f = fixture();
    await f.controller.observe(target);
    expect(f.frames.map(frame => frame.command)).toEqual(["get_protocol_info", "subscribe_sessions", "list_sessions", "get_protocol_info", "release_session"]);
    expect(f.frames.at(-1)?.fields).toEqual({ sessionId: "rpc-foreign", reason: "takeover" });
    expect(f.frames.find(frame => frame.command === "subscribe_sessions")?.fields).toMatchObject({ include_workers: true });
    expect(f.lease.watch).toHaveBeenCalledBefore(f.lookup);
    expect(f.open).toHaveBeenCalledExactlyOnceWith(target);
    expect(f.snapshots.map(snapshot => snapshot.writable)).toEqual([false, true]);
    expect(() => f.controller.assertWritable(target.id)).not.toThrow();
  });
  it.each(["attached", "busy", "tui", "unverified", "reused endpoint"])("keeps %s ownership read-only without release", async kind => {
    const f = fixture(kind === "tui" ? [{ ...holder, endpointKind: "tui" }] : kind === "unverified" ? [{ ...holder, identity: "unverified" }] : [holder]);
    if (kind === "attached") f.setRow({ sessionId: "rpc-foreign", durableSessionId: target.id, sessionPath: target.sessionPath, status: "open", attachments: 1, retain_on_disconnect: true });
    if (kind === "busy") f.setRelease(async () => { throw new Error("turn_active"); });
    if (kind === "reused endpoint") f.setInstance("new-generation");
    await f.controller.observe(target);
    expect(f.open).not.toHaveBeenCalled();
    if (kind !== "busy") expect(f.frames.some(frame => frame.command === "release_session")).toBe(false);
    expect(() => f.controller.assertWritable(target.id)).toThrow("session_held:");
    f.controller.close();
  });
  it("a matching owner closed lifecycle edge promotes once; foreign subscriptions and late echoes do not", async () => {
    const f = fixture();
    f.setRow({ sessionId: "rpc-foreign", durableSessionId: target.id, sessionPath: target.sessionPath, status: "open", attachments: 1, retain_on_disconnect: true });
    await f.controller.observe(target);
    f.setRow(null);
    const before = f.frames.length;
    f.status("other-subscription");
    f.status("sub-1", "another-thread");
    expect(f.frames).toHaveLength(before);
    f.status();
    await bounded(f.promoted.promise);
    f.status();
    expect(f.open).toHaveBeenCalledOnce();
    expect(f.frames.every(frame => !["prompt", "steer", "follow_up", "open_session", "attach_session", "reclaim_session", "abort"].includes(frame.command))).toBe(true);
    f.controller.close();
  });
  it("dead or reused PID evidence delegates reclamation to native open instead of touching the lease", async () => {
    const f = fixture([]);
    await f.controller.observe(target);
    expect(f.open).toHaveBeenCalledOnce();
    expect(f.frames).toEqual([]);
  });
  it("drains a detach edge delivered while an older attached snapshot is still in flight", async () => {
    const f = fixture();
    const attached = { sessionId: "rpc-foreign", durableSessionId: target.id, sessionPath: target.sessionPath, status: "open", attachments: 1, retain_on_disconnect: true, kind: "worker" };
    f.setRow(attached);
    await f.controller.observe(target);
    const stale = deferred<unknown>();
    f.list.mockImplementationOnce(() => stale.promise);
    f.status();
    f.status();
    f.setRow({ ...attached, attachments: 0 });
    stale.resolve({ sessions: [attached] });
    await bounded(f.promoted.promise);
    expect(f.open).toHaveBeenCalledOnce();
    f.controller.close();
  });
  it("a failed native open never publishes writable, even after the foreign owner released", async () => {
    const snapshots: OwnershipSnapshot[] = [];
    const lease: Pick<SessionHolders, "lookup" | "watch"> = { lookup: async () => ({}), watch: () => () => {} };
    const controller = new NativeOwnership({ holders: lease, peer: () => { throw new Error("unexpected peer"); }, open: async () => { throw new Error("session_held"); }, changed: snapshot => snapshots.push(snapshot) });
    await controller.observe(target);
    expect(snapshots.map(snapshot => snapshot.writable)).toEqual([false]);
    expect(() => controller.assertWritable(target.id)).toThrow("session_held:");
    controller.close();
  });
  it("a lease replacement while probing cannot release the old endpoint's session", async () => {
    const f = fixture();
    f.lookup.mockResolvedValueOnce({ [target.id]: [holder] }).mockResolvedValueOnce({ [target.id]: [{ ...holder, processStartedAtMs: 2000 }] });
    await f.controller.observe(target);
    expect(f.frames.some(frame => frame.command === "release_session")).toBe(false);
    expect(f.open).not.toHaveBeenCalled();
    f.controller.close();
  });
  it("closing the observer cancels promotion after an in-flight release", async () => {
    const f = fixture();
    const releasing = deferred<void>();
    const released = deferred<unknown>();
    f.setRelease(() => { releasing.resolve(); return released.promise; });
    const pending = f.controller.observe(target);
    await bounded(releasing.promise);
    f.controller.close();
    released.resolve({ released: true, session_path: target.sessionPath });
    await pending;
    expect(f.open).not.toHaveBeenCalled();
    expect(f.snapshots.every(snapshot => !snapshot.writable)).toBe(true);
  });
});
