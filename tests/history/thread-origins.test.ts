import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadThreadOrigins, threadOrigin } from "../../electron/history/thread-origins";

vi.mock("node:fs", () => ({ createReadStream: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const sessionId = "cf7aa845-06be-4d21-a435-9baad11455b9";
const answerId = "a493dc27-aeca-4875-be4f-70cafd8e3644";
const header = { type: "session", version: 3, id: sessionId };
const jsonl = (...entries: object[]) => entries.map(entry => JSON.stringify(entry)).join("\n") + "\n";
const admission = (clientMessageId: string, durableSessionId = sessionId) => ({
  type: "custom", customType: "rpc_client_message_admission", data: { clientMessageId, durableSessionId },
});
const origin = (text: string) => threadOrigin(text.split("\n"));
const stream = (text: string) => Readable.from([text]) as ReturnType<typeof createReadStream>;

describe("read-only machine session origins", () => {
  it.each([`probe-owner:${sessionId}`, `answer-probe:${answerId}`])("recognizes proven probe admission %s without a parent header", async id => {
    expect(await origin(jsonl(header, admission(id)))).toBe("agent");
  });

  it("recognizes a proven Discord admission as Dori-created", async () => {
    expect(await origin(jsonl(header, admission("discord:1557276589203656765")))).toBe("dori");
  });

  it("does not infer origin from a recovery, answer, or question title or quoted marker", async () => {
    for (const name of ["recovery-probe-recovery", "answer-contract", "question-contract"]) {
      expect(await origin(jsonl(header, { type: "session_info", name }, {
        type: "message", message: { role: "user", clientMessageId: `probe-owner:${sessionId}`, content: JSON.stringify(admission(`probe-owner:${sessionId}`)) },
      }))).toBeUndefined();
    }
  });

  it("leaves ordinary RPC admissions and unproven namespaces unknown", async () => {
    for (const id of ["discord:", "discord:not-a-number", "discord:1557276589203656765:suffix", `probe:${answerId}`, `question-contract:${answerId}`, "probe-owner:not-a-uuid", `probe-owner:${sessionId}:suffix`]) {
      expect(await origin(jsonl(header, admission(id)))).toBeUndefined();
    }
  });

  it.each([`probe-owner:${sessionId}`, "discord:1557276589203656765"])("requires a native custom admission matching the durable session header for %s", async id => {
    const marker = admission(id);
    expect(await origin(jsonl(marker))).toBeUndefined();
    expect(await origin(jsonl(header, admission(id, answerId)))).toBeUndefined();
    expect(await origin(jsonl(header, { ...marker, type: "custom_message" }))).toBeUndefined();
    expect(await origin(jsonl(header, { ...marker, data: null }))).toBeUndefined();
  });

  it("tolerates malformed records and an incomplete live tail", async () => {
    expect(await origin(jsonl(header) + "{broken\n" + jsonl(admission(`probe-owner:${sessionId}`)) + '{"type":')).toBe("agent");
    expect(await origin("null\n[]\n" + jsonl(header) + '{"type":')).toBeUndefined();
  });

  it.each(["user", "agent", "dori"])("stops reading immediately after creation origin is determined by %s", async kind => {
    let closed = false;
    function* lines() {
      try {
        yield JSON.stringify(header);
        yield JSON.stringify(kind === "user" ? { type: "message", message: { role: "user" } } : admission(kind === "agent" ? `probe-owner:${sessionId}` : "discord:1557276589203656765"));
        throw new Error("Transcript tail must not be read");
      } finally { closed = true; }
    }
    expect(await threadOrigin(lines())).toBe(kind === "user" ? undefined : kind);
    expect(closed).toBe(true);
  });

  it.each([`probe-owner:${sessionId}`, "discord:1557276589203656765"])("does not reclassify an ordinary session from a later admission %s", async id => {
    expect(await origin(jsonl(header, { type: "message", message: { role: "user" } }, admission(id)))).toBeUndefined();
  });

  it("resolves unique paths and only returns proven origins keyed by requested paths", async () => {
    const resolve = vi.fn(async (file: string) => `/sessions/${file}`);
    const opened: Readable[] = [];
    vi.mocked(createReadStream).mockImplementation(file => {
      expect(opened.every(input => input.destroyed)).toBe(true);
      const input = stream(file === "/sessions/probe" ? jsonl(header, admission(`probe-owner:${sessionId}`)) :
        file === "/sessions/discord" ? jsonl(header, admission("discord:1557276589203656765")) : jsonl(header));
      opened.push(input);
      return input;
    });
    expect(await loadThreadOrigins(["probe", "ordinary", "discord", "probe"], resolve)).toEqual({ probe: "agent", discord: "dori" });
    expect(resolve.mock.calls).toEqual([["probe"], ["ordinary"], ["discord"]]);
    expect(vi.mocked(createReadStream).mock.calls).toEqual([
      ["/sessions/probe", { encoding: "utf8", highWaterMark: 4096 }], ["/sessions/ordinary", { encoding: "utf8", highWaterMark: 4096 }],
      ["/sessions/discord", { encoding: "utf8", highWaterMark: 4096 }],
    ]);
    expect(opened.every(input => input.destroyed)).toBe(true);
  });

  it("omits files removed after listing without losing other origins", async () => {
    vi.mocked(createReadStream).mockImplementation(() => stream(jsonl(header, admission(`answer-probe:${answerId}`))));
    const resolve = async (file: string) => {
      if (file === "missing") throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return file;
    };
    expect(await loadThreadOrigins(["missing", "probe"], resolve)).toEqual({ probe: "agent" });
  });

  it("propagates containment and read failures instead of treating them as unknown", async () => {
    await expect(loadThreadOrigins(["outside"], async () => { throw new Error("outside sessions directory"); })).rejects.toThrow("outside sessions directory");
    expect(createReadStream).not.toHaveBeenCalled();
    const failed = Readable.from((async function* () { throw Object.assign(new Error("denied"), { code: "EACCES" }); })());
    vi.mocked(createReadStream).mockReturnValue(failed as ReturnType<typeof createReadStream>);
    await expect(loadThreadOrigins(["private"], async file => file)).rejects.toThrow("denied");
    expect(failed.destroyed).toBe(true);
  });
});
