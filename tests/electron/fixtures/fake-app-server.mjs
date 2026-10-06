// Scripted stand-in for `omo app-server --listen stdio://` used by the client tests.
import { createInterface } from "node:readline";

const initDelayMs = Number(process.env.STUB_INIT_DELAY_MS ?? "0");
const ignoreStdinEnd = process.env.STUB_IGNORE_STDIN === "1";
if (process.env.STUB_IGNORE_SIGTERM === "1") process.on("SIGTERM", () => {});

const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");
process.stderr.write("senpi app-server listening on stdio://\n");

const held = [];
let pendingTurn = null;

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.id === "user-input-0" && pendingTurn !== null) {
    send({ method: "test/answered", params: frame });
    send({ id: pendingTurn, result: { turn: { id: "turn-1", items: [], status: "completed", error: null } } });
    pendingTurn = null;
    return;
  }
  switch (frame.method) {
    case "initialize":
      if (process.env.STUB_BAD_INIT === "1") {
        send({ id: frame.id, result: { userAgent: 42 } });
        return;
      }
      setTimeout(() => send({ id: frame.id, result: { userAgent: "fake/1.0", codexHome: "/tmp/fake-codex", platformFamily: "unix", platformOs: "macos" } }), initDelayMs);
      return;
    case "initialized":
      return;
    case "thread/read":
      held.push(frame);
      return;
    case "thread/archive":
      for (const request of held.reverse()) send({ id: request.id, result: { thread: { id: request.params.threadId } } });
      held.length = 0;
      send({ id: frame.id, result: {} });
      return;
    case "turn/start":
      pendingTurn = frame.id;
      send({ method: "turn/started", params: { threadId: frame.params.threadId }, emittedAtMs: 5 });
      send({ id: "user-input-0", method: "item/tool/requestUserInput", params: { threadId: frame.params.threadId } });
      return;
    case "model/list":
      process.stdout.write("garbage line\n");
      send({ id: frame.id, result: { data: [], nextCursor: null } });
      return;
    case "thread/name/set":
      send({ id: frame.id, error: { code: -32602, message: "bad name", data: { field: "name" } } });
      return;
    case "thread/delete":
      process.stderr.write("boom-stderr\n", () => process.exit(7));
      return;
    default:
      return;
  }
});
lines.on("close", () => {
  if (ignoreStdinEnd) setInterval(() => {}, 1000);
  else process.exit(0);
});
