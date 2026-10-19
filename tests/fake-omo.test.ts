import { execFile, spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { parseSessionJsonl } from "../electron/history/session-jsonl";
import type { SpawnImpl } from "../electron/omo/app-server-client";
import type { ExitInfo } from "../electron/omo/managed-child";
import { NativeAppServerClient } from "../electron/omo/native/client";
import { NativeCommandError, NativeConnection } from "../electron/omo/native/connection";
import type { ClientMethod, ClientParams } from "../shared/protocol";
import { parseLiveExtension } from "../src/state/live-wire";
import { createInitialState, reduce, selectDagRuns, selectGoal, selectTasks } from "../src/state";

const FIXTURE = fileURLToPath(new URL("./fixtures/fake-omo.mjs", import.meta.url));
const HOST_ARGS = ["--mode", "rpc", "--multi-session", "--session-runtime", "in-process"];
const WAIT_MS = 10_000;
const execFileAsync = promisify(execFile);
// On Windows the connection already runs an .mjs command through Node with the script as its first argument.
const spawnFixture: SpawnImpl = (_command, args, options) => spawn(process.execPath, args[0] === FIXTURE ? args : [FIXTURE, ...args], options);

type Frame = Record<string, unknown>;

function isRecord(value: unknown): value is Frame {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function at(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function str(value: unknown): string {
  if (typeof value !== "string") throw new Error(`expected string, got ${JSON.stringify(value)}`);
  return value;
}

function processEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  return { ...env, ...extra };
}

/** The app's Native RPC adapter driving the fake omo host; frames are the app-server notifications and requests it emits. */
class FakeOmo {
  readonly frames: Frame[] = [];
  readonly client: NativeAppServerClient;
  private readonly exit: Promise<ExitInfo>;
  private readonly listeners = new Set<() => void>();

  constructor(readonly home: string, cwd: string, logPath: string, env: Record<string, string> = {}) {
    this.client = new NativeAppServerClient({
      command: FIXTURE, args: HOST_ARGS, cwd, clientVersion: "test", spawnImpl: spawnFixture,
      env: processEnv({ FAKE_OMO_HOME: home, FAKE_OMO_LOG: logPath, ...env }),
      agentDir: home, stateDir: join(home, "..", "state"),
    });
    this.exit = new Promise((resolve) => this.client.onExit(resolve));
    this.client.onNotification((notification) => this.push({ ...notification }));
    this.client.onServerRequest((request) => this.push({ ...request }));
  }

  private push(frame: Frame): void {
    this.frames.push(frame);
    for (const listener of [...this.listeners]) listener();
  }

  waitFrame(predicate: (frame: Frame) => boolean, label: string): Promise<Frame> {
    return new Promise((resolve, reject) => {
      const first = this.frames.find(predicate);
      if (first !== undefined) {
        resolve(first);
        return;
      }
      const listener = (): void => {
        const found = this.frames.find(predicate);
        if (found === undefined) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(found);
      };
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`timed out waiting for ${label}`));
      }, WAIT_MS);
      this.listeners.add(listener);
    });
  }

  request<M extends ClientMethod>(method: M, params: ClientParams<M>): Promise<unknown> {
    return this.client.request(method, params);
  }

  async rejection<M extends ClientMethod>(method: M, params: ClientParams<M>): Promise<{ code: unknown; message: unknown }> {
    return this.client.request(method, params).then(
      () => { throw new Error(`${method} was accepted`); },
      (error: unknown) => ({ code: at(error, "code"), message: at(error, "message") }),
    );
  }

  async startThread(cwd: string): Promise<string> {
    return str(at(await this.request("thread/start", { cwd }), "thread", "id"));
  }

  async startTurn(threadId: string, text: string): Promise<string> {
    const result = await this.request("turn/start", {
      threadId, input: [{ type: "text", text, text_elements: [] }], clientUserMessageId: "client-msg-1",
    });
    return str(at(result, "turn", "id"));
  }

  waitTurnCompleted(turnId: string): Promise<Frame> {
    return this.waitFrame((frame) => frame.method === "turn/completed" && at(frame, "params", "turn", "id") === turnId, `turn/completed ${turnId}`);
  }

  waitServerRequest(method: string): Promise<Frame> {
    return this.waitFrame((frame) => frame.method === method && "id" in frame && !this.answered.has(frame["id"]), `server request ${method}`);
  }

  private readonly answered = new Set<unknown>();

  answer(request: Frame, result: unknown): void {
    this.answered.add(request["id"]);
    this.client.respond(str(request["id"]), result);
  }

  agentTexts(): string[] {
    return this.frames
      .filter((frame) => frame.method === "item/completed" && at(frame, "params", "item", "type") === "agentMessage")
      .map((frame) => str(at(frame, "params", "item", "text")));
  }

  async close(): Promise<number | null> {
    await this.client.stop();
    return (await this.exit).code;
  }
}

interface Sandbox {
  dir: string;
  home: string;
  launch(logName?: string, env?: Record<string, string>): Promise<FakeOmo>;
}

const sandboxDirs: string[] = [];
const liveClients: FakeOmo[] = [];

async function sandbox(): Promise<Sandbox> {
  const dir = await mkdtemp(join(tmpdir(), "fake-omo-test-"));
  sandboxDirs.push(dir);
  const home = join(dir, "home");
  return {
    dir,
    home,
    async launch(logName = "log.jsonl", env = {}) {
      const client = new FakeOmo(home, dir, join(dir, logName), env);
      liveClients.push(client);
      await client.client.start();
      return client;
    },
  };
}

async function readJsonLines(file: string): Promise<Frame[]> {
  const text = await readFile(file, "utf8");
  return text.split("\n").filter((line) => line.length > 0).map((line) => {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) throw new Error(`non-object line in ${file}`);
    return parsed;
  });
}

async function runFullScenario(client: FakeOmo, threadId: string, approval: unknown = { decision: "accept" }): Promise<Frame> {
  const turnId = await client.startTurn(threadId, "SCENARIO:full please");
  client.answer(await client.waitServerRequest("item/commandExecution/requestApproval"), approval);
  client.answer(await client.waitServerRequest("item/tool/requestUserInput"), { answers: { q1: { answers: ["B"] } } });
  return client.waitTurnCompleted(turnId);
}

afterEach(async () => {
  await Promise.all(liveClients.splice(0).map((client) => client.client.stop()));
  await Promise.all(sandboxDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("fake omo Native RPC host through the app's adapter", () => {
  it("advances live DAG task todo and goal stages only on explicit requests", async () => {
    const box = await sandbox();
    const client = await box.launch();
    const threadId = await client.startThread(box.dir);
    expect(await client.request("thread/goal/get", { threadId })).toEqual({ goal: null });
    const stage1 = client.waitFrame((frame) => frame.method === "extension_event" && at(frame, "params", "name") === "omo.dag.updated", "initial DAG");
    const turnId = await client.startTurn(threadId, "SCENARIO:omo-live");
    const first = await stage1;
    expect(at(first, "params", "data", "runs")).toMatchObject([{ name: "mass-ulw display", status: "running",
      nodes: [{ id: "A", state: "running" }, { id: "B", state: "blocked" }, { id: "C", state: "blocked" }],
      waves: [{ index: 0, node_ids: ["A"] }, { index: 1, node_ids: ["B", "C"] }],
    }]);
    await client.waitFrame((frame) => frame.method === "thread/goal/updated", "goal published after the task call");
    expect(at(await client.request("thread/goal/get", { threadId }), "goal", "objective")).toBe("Ship the OmO UI app");
    const before = client.frames.filter((frame) => at(frame, "params", "name") === "omo.dag.updated").length;
    await client.request("thread/goal/get", { threadId });
    expect(client.frames.filter((frame) => at(frame, "params", "name") === "omo.dag.updated")).toHaveLength(before);

    await client.request("extension_request", { threadId, name: "fake.advance", data: {} });
    const stages = client.frames.filter((frame) => at(frame, "params", "name") === "omo.dag.updated");
    expect(at(stages[1], "params", "data", "runs")).toMatchObject([{ nodes: [
      { id: "A", state: "completed" }, { id: "B", state: "running" }, { id: "C", state: "scheduled" },
    ] }]);
    expect(client.frames.find((frame) => at(frame, "params", "name") === "omo.dag.activity")).toMatchObject({
      params: { data: { nodeId: "B", activity: "implementing" } },
    });
    const completed = client.waitTurnCompleted(turnId);
    await client.request("extension_request", { threadId, name: "fake.advance", data: {} });
    await completed;
    await client.waitFrame((frame) => frame.method === "thread/goal/cleared", "goal cleared at the run's end");
    expect(await client.request("thread/goal/get", { threadId })).toEqual({ goal: null });
    const final = client.frames.filter((frame) => at(frame, "params", "name") === "omo.dag.updated").at(-1);
    expect(at(final, "params", "data", "runs")).toMatchObject([{ status: "failed", nodes: [
      { id: "A", state: "completed" }, { id: "B", state: "failed", last_error: { code: "provider_error", message: "402: Insufficient Balance" } }, { id: "C", state: "skipped" },
    ] }]);
    const history = parseSessionJsonl(await readFile(join(box.home, "sessions", `${threadId}.jsonl`), "utf8"));
    expect(history.todo?.phases).toMatchObject([{ name: "Implementation" }, { name: "Verification", tasks: [{ status: "abandoned" }, { status: "pending" }] }]);
    expect(history.tasks).toMatchObject([
      { task_id: "task-A", status: "completed", final_response: "A completed", model: "fake/alpha", source: "history" },
      { task_id: "task-B", status: "error", error_message: "402: Insufficient Balance", model: "fake/alpha", source: "history" },
    ]);
    expect(client.frames.find((frame) => frame.method === "item/completed" && at(frame, "params", "item", "tool") === "todo")).toBeDefined();
    let state = createInitialState();
    for (const frame of client.frames) {
      if (typeof frame.method !== "string" || "id" in frame) continue;
      if (frame.method === "extension_event") {
        expect(parseLiveExtension(str(at(frame, "params", "name")), at(frame, "params", "data"))).not.toBeNull();
      }
      state = reduce(state, { type: "rpc/notification", notification: { method: frame.method, params: frame.params }, receivedAtMs: 1 });
    }
    expect(selectDagRuns(state, threadId)[0]?.status).toBe("failed");
    expect(selectTasks(state, threadId)).toMatchObject([{ status: "completed", final_response: "A completed" }, { status: "error" }]);
    expect(selectGoal(state, threadId)).toBeNull();
    expect(await client.close()).toBe(0);
  });

  function skillNames(result: unknown): string[] {
    const skills = at((at(result, "data") as Frame[])[0], "skills");
    if (!Array.isArray(skills)) throw new Error("expected skills");
    return skills.map((skill) => str(at(skill, "name")));
  }

  it("lists a cwd's skills from omo's commands before and after a thread opens there", async () => {
    const box = await sandbox();
    const client = await box.launch();
    const early = await client.request("skills/list", { cwds: [box.dir] });
    await client.startThread(box.dir);
    const loaded = await client.request("skills/list", { cwds: [box.dir] });

    const bundled = ["ulw-loop", "mass-ulw", "plan", "user-only-skill", "long-description-skill"];
    expect(skillNames(early)).toEqual(bundled);
    expect(skillNames(loaded)).toEqual(bundled);
    const skills = at((at(loaded, "data") as Frame[])[0], "skills") as Frame[];
    expect(skills.find((skill) => skill["name"] === "user-only-skill")).toMatchObject({ enabled: false, scope: "user" });
    expect(str(skills.find((skill) => skill["name"] === "long-description-skill")?.["description"])).toHaveLength(400);
    const commands = (await readJsonLines(join(box.dir, "log.jsonl"))).filter((frame) => frame["type"] === "get_commands");
    expect(commands).toHaveLength(2);
    expect(commands[0]?.["sessionId"]).not.toBe(commands[1]?.["sessionId"]);
    expect(await client.close()).toBe(0);
  });

  it("maps configured skills per cwd and reports a missing cwd", async () => {
    const box = await sandbox();
    const otherCwd = join(box.dir, "other");
    const data = [{
      cwd: box.dir,
      skills: [{ name: "custom", path: "/fake/custom/SKILL.md", scope: "repo", enabled: false, description: "Custom" }],
      errors: [],
    }];
    const client = await box.launch("log.jsonl", { FAKE_OMO_SKILLS: JSON.stringify({ data }) });
    const result = await client.request("skills/list", { cwds: [otherCwd, box.dir], forceReload: true });
    expect(at(result, "data")).toEqual([
      { cwd: otherCwd, skills: [], errors: [{ path: otherCwd, message: "skill cwd does not exist" }] },
      { cwd: box.dir, skills: [{ name: "custom", description: "Custom", path: "/fake/custom/SKILL.md", scope: "repo", enabled: false }], errors: [] },
    ]);
    expect(await client.close()).toBe(0);
  });

  it("rejects structured skill input with invalid params before starting a turn", async () => {
    const box = await sandbox();
    const client = await box.launch();
    const threadId = await client.startThread(box.dir);
    const rejected = await client.rejection("turn/start", {
      threadId, input: [{ type: "skill", name: "ulw-loop", path: "/fake/skills/ulw-loop/SKILL.md" }],
    });
    expect(rejected.code).toBe(-32602);
    expect(client.frames.some((frame) => frame.method === "turn/started")).toBe(false);
    const turnId = await client.startTurn(threadId, "/skill:ulw-loop /skill:plan do work");
    await client.waitTurnCompleted(turnId);
    const user = client.frames.find((frame) => frame.method === "item/completed" && at(frame, "params", "item", "type") === "userMessage");
    expect(at(user, "params", "item", "content")).toEqual([{ type: "text", text: "/skill:ulw-loop /skill:plan do work", text_elements: [] }]);
    expect(await client.close()).toBe(0);
  });

  it("prints its version and rejects unknown arguments with exit code 2", async () => {
    const version = await execFileAsync(process.execPath, [FIXTURE, "--version"]);
    expect(version.stdout).toBe("omo 5.1.4-fake (engine: fake)\n");

    const rejection = await execFileAsync(process.execPath, [FIXTURE, "app-server", "--listen", "stdio://"]).then(
      () => null,
      (error: unknown) => error,
    );
    expect(at(rejection, "code")).toBe(2);
  });

  it("answers pong and completes the turn", async () => {
    const box = await sandbox();
    const client = await box.launch();
    expect(client.client.initializeResult).toMatchObject({ userAgent: "omo/5.1.4-fake", codexHome: box.home });
    const threadId = await client.startThread(box.dir);

    const turnId = await client.startTurn(threadId, "Reply with exactly: pong");
    const completed = await client.waitTurnCompleted(turnId);

    expect(at(completed, "params", "turn", "status")).toBe("completed");
    expect(client.agentTexts()).toEqual(["pong"]);
    expect(await client.close()).toBe(0);
  });

  it("answers an OmO UI side chat with its question and the main messages it carried", async () => {
    const box = await sandbox();
    const client = await box.launch();
    const threadId = await client.startThread(box.dir);
    const prompt = [
      "[OmO UI side chat background]",
      "Main thread: Fix login",
      "",
      "<user>\nfix the login bug\n</user>",
      "<assistant>\nFixed it.\n</assistant>",
      "[end of background]",
      "",
      "Side question: what changed?",
    ].join("\n");

    const turnId = await client.startTurn(threadId, prompt);
    await client.waitTurnCompleted(turnId);

    expect(client.agentTexts()).toEqual(['Side answer to "what changed?" from 2 main messages; the first main request was "fix the login bug".']);
    expect(await client.close()).toBe(0);
  });

  it("refuses session commands without a session and unknown commands, like omo's response envelope", async () => {
    const box = await sandbox();
    const connection = new NativeConnection({ command: FIXTURE, args: HOST_ARGS, cwd: box.dir, env: processEnv({ FAKE_OMO_HOME: box.home }), spawnImpl: spawnFixture });
    connection.start();
    try {
      expect(await connection.send("get_protocol_info", {}, WAIT_MS)).toMatchObject({ mode: "multi", serverVersion: "5.1.4-fake" });
      const missing = await connection.send("get_state", {}, WAIT_MS).catch((error: unknown) => error);
      expect(missing).toBeInstanceOf(NativeCommandError);
      expect(missing).toMatchObject({ errorCode: "missing_session_id" });
      const opened = await connection.send("open_session", { cwd: box.dir }, WAIT_MS);
      const unknown = await connection.send("no_such_command", { sessionId: at(opened, "sessionId") }, WAIT_MS).catch((error: unknown) => error);
      expect(unknown).toMatchObject({ errorCode: "unknown_command" });
    } finally {
      await connection.stop({ afterStdinEnd: 2_000, afterSigterm: 2_000 });
    }
    const client = await box.launch();
    expect(await client.rejection("no/such/method" as ClientMethod, {} as never)).toMatchObject({ code: -32601 });
    expect(await client.close()).toBe(0);
  });

  it("runs the full scenario through omo's permission prompt and question dialog", async () => {
    const box = await sandbox();
    const client = await box.launch();
    const threadId = await client.startThread(box.dir);

    const completed = await runFullScenario(client, threadId);

    expect(at(completed, "params", "turn", "status")).toBe("completed");
    expect(client.agentTexts().at(-1)).toContain("You picked **B**");
    const approval = client.frames.find((frame) => frame.method === "item/commandExecution/requestApproval");
    expect(approval?.["params"]).toMatchObject({ threadId, command: "rm -rf /tmp/fake-demo", reason: "Command: $ rm -rf /tmp/fake-demo" });
    const toolDone = client.frames.find((frame) => frame.method === "item/completed" && at(frame, "params", "item", "type") === "dynamicToolCall");
    expect(at(toolDone, "params", "item", "success")).toBe(true);
    expect(client.frames.filter((frame) => frame.method === "serverRequest/resolved")).toHaveLength(2);

    const answers = (await readJsonLines(join(box.dir, "log.jsonl"))).filter((frame) => frame["type"] === "extension_ui_response");
    expect(answers[0]).toMatchObject({ value: "Allow once", threadId });
    expect(answers[1]).toMatchObject({ answers: { q1: { selected: ["B"] } }, threadId });
    expect(await client.close()).toBe(0);
  });

  it("denies with feedback through the follow-up input dialog", async () => {
    const box = await sandbox();
    const client = await box.launch();
    const threadId = await client.startThread(box.dir);

    await runFullScenario(client, threadId, { decision: "decline", reason: "not on this machine" });

    const toolDone = client.frames.find((frame) => frame.method === "item/completed" && at(frame, "params", "item", "type") === "dynamicToolCall");
    expect(at(toolDone, "params", "item", "success")).toBe(false);
    const answers = (await readJsonLines(join(box.dir, "log.jsonl"))).filter((frame) => frame["type"] === "extension_ui_response");
    expect(answers.slice(0, 2)).toMatchObject([{ value: "Deny with feedback" }, { value: "not on this machine" }]);
    expect(await client.close()).toBe(0);
  });

  it("reports session stats, the fast-mode tier and ChatGPT-only refusals", async () => {
    const box = await sandbox();
    const client = await box.launch();
    const threadId = await client.startThread(box.dir);

    expect(await client.request("thread/stats", { threadId })).toEqual({
      stats: {
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0,
        contextUsage: { tokens: null, contextWindow: 128000, percent: null },
      },
    });
    await client.waitTurnCompleted(await client.startTurn(threadId, "usage-turn"));
    expect(await client.request("thread/stats", { threadId })).toEqual({
      stats: {
        tokens: { input: 24000, output: 1000, cacheRead: 0, cacheWrite: 0, total: 25000 }, cost: 0.07,
        contextUsage: { tokens: 25000, contextWindow: 128000, percent: 20 },
      },
    });

    expect(await client.request("thread/fastMode/get", { threadId })).toEqual({ fastMode: { enabled: false, serviceTier: null } });
    expect(await client.rejection("thread/fastMode/set", { threadId, enabled: true }))
      .toMatchObject({ message: "Fast mode is only available for ChatGPT Subscription models." });
    expect(await client.rejection("thread/fastMode/set", { threadId, enabled: "yes" as never })).toMatchObject({ code: -32602 });
    await client.request("thread/settings/update", { threadId, model: "chatgpt-subscription/gpt-6-sol-fast" });
    expect(await client.request("thread/fastMode/set", { threadId, enabled: true })).toEqual({ fastMode: { enabled: true, serviceTier: "priority" } });
    expect(await client.request("thread/fastMode/get", { threadId })).toEqual({ fastMode: { enabled: true, serviceTier: "priority" } });
    expect(await client.request("thread/fastMode/set", { threadId, enabled: false })).toEqual({ fastMode: { enabled: false, serviceTier: null } });

    const target = join(box.dir, "exported-session.html");
    expect(await client.request("thread/export", { threadId, outputPath: target })).toEqual({ path: target });
    const html = await readFile(target, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("echo: usage-turn");
    expect(await client.close()).toBe(0);
  });

  it("interrupts the slow scenario", async () => {
    const box = await sandbox();
    const client = await box.launch();
    const threadId = await client.startThread(box.dir);

    const turnId = await client.startTurn(threadId, "SCENARIO:slow");
    await client.waitFrame((frame) => frame.method === "item/agentMessage/delta", "first tick");
    await client.request("turn/interrupt", { threadId, turnId });
    const completed = await client.waitTurnCompleted(turnId);

    expect(at(completed, "params", "turn", "status")).toBe("interrupted");
    expect(await client.close()).toBe(0);
  });

  it("queues follow-ups for after the turn, edits and withdraws them, and shows the delivered one as a user message", async () => {
    const box = await sandbox();
    const client = await box.launch();
    const threadId = await client.startThread(box.dir);
    // The gate keeps the run open until the queue has been changed, so the delivery order does not depend on timing.
    const gate = join(box.dir, "release-follow-ups");
    const turnId = await client.startTurn(threadId, `SCENARIO:gate:${gate}`);
    const input = (text: string) => [{ type: "text" as const, text, text_elements: [] }];
    await client.request("turn/followUp", { threadId, input: input("keep me") });
    await client.request("turn/followUp", { threadId, input: input("drop me") });
    type Row = { queuedId: string | null; mode: string; text: string };
    const rows = (frame: Frame): Row[] => at(frame, "params", "data", "items") as Row[];
    const queued = await client.waitFrame((frame) => frame.method === "extension_event" && at(frame, "params", "name") === "omo.queue.updated" && rows(frame).length === 2, "two queued messages");
    const [keep, drop] = rows(queued) as [Row, Row];
    expect(keep).toMatchObject({ mode: "followUp", text: "keep me" });
    expect(await client.request("queue/edit", { threadId, queuedId: keep.queuedId!, text: "kept" })).toEqual({ status: "edited" });
    expect(await client.request("queue/dequeue", { threadId, queuedId: drop.queuedId! })).toEqual({ status: "removed" });
    writeFileSync(gate, "");
    await client.waitTurnCompleted(turnId);
    const userTexts = client.frames
      .filter((frame) => frame.method === "item/completed" && at(frame, "params", "item", "type") === "userMessage")
      .map((frame) => JSON.stringify(at(frame, "params", "item", "content")));
    expect(userTexts.some((text) => text.includes("kept"))).toBe(true);
    expect(userTexts.some((text) => text.includes("keep me") || text.includes("drop me"))).toBe(false);
    expect(await client.close()).toBe(0);
  });

  it("ends a turn on agent_end when omo's settle record is lost", async () => {
    const box = await sandbox();
    const client = await box.launch();
    const threadId = await client.startThread(box.dir);
    const turnId = await client.startTurn(threadId, "SCENARIO:lost-completion first");
    expect(at(await client.waitTurnCompleted(turnId), "params", "turn", "status")).toBe("completed");
    expect(await client.close()).toBe(0);
  });

  it("closes a turn whose end records never came once omo refuses the steer, so the next message starts a turn", async () => {
    const box = await sandbox();
    const client = await box.launch();
    const threadId = await client.startThread(box.dir);
    const turnId = await client.startTurn(threadId, "SCENARIO:silent-end first");
    await client.waitFrame((frame) => frame.method === "item/completed" && at(frame, "params", "item", "text") === "echo: SCENARIO:silent-end first", "echo");

    const refused = await client.rejection("turn/steer", { threadId, expectedTurnId: turnId, input: [{ type: "text", text: "after", text_elements: [] }] });
    expect(refused.message).toBe("No agent run to steer");
    expect(at(await client.waitTurnCompleted(turnId), "params", "turn", "status")).toBe("completed");
    const next = await client.startTurn(threadId, "after a silent end");
    await client.waitTurnCompleted(next);
    expect(client.agentTexts().at(-1)).toBe("echo: after a silent end");
    expect(await client.close()).toBe(0);
  });

  it("sets, replaces, pauses and clears a goal through omo's /goal command", async () => {
    const box = await sandbox();
    const client = await box.launch();
    const threadId = await client.startThread(box.dir);

    expect(at(await client.request("thread/goal/set", { threadId, objective: "Ship it" }), "goal", "objective")).toBe("Ship it");
    expect(await client.request("thread/goal/set", { threadId, objective: "Ship again" })).toMatchObject({ goal: { objective: "Ship again", status: "active" } });
    expect(await client.request("thread/goal/set", { threadId, status: "paused" })).toMatchObject({ goal: { objective: "Ship again", status: "paused" } });
    await client.request("thread/goal/clear", { threadId });
    expect(await client.request("thread/goal/get", { threadId })).toEqual({ goal: null });

    expect(client.frames.filter((frame) => frame.method === "thread/goal/updated").map((frame) => at(frame, "params", "goal", "status"))).toEqual(["active", "active", "paused"]);
    expect(client.frames.filter((frame) => frame.method === "thread/goal/cleared")).toHaveLength(1);
    expect(client.frames.some((frame) => frame.method === "item/commandExecution/requestApproval")).toBe(false);
    const prompts = (await readJsonLines(join(box.dir, "log.jsonl"))).filter((frame) => frame["type"] === "prompt").map((frame) => frame["message"]);
    expect(prompts).toEqual(["/goal Ship it", "/goal Ship again", "/goal pause", "/goal clear"]);
    expect(await client.close()).toBe(0);
  });

  it("writes a session file with user, assistant and tool result entries", async () => {
    const box = await sandbox();
    const client = await box.launch();
    const threadId = await client.startThread(box.dir);
    await runFullScenario(client, threadId);

    const entries = await readJsonLines(join(box.home, "sessions", `${threadId}.jsonl`));

    expect(at(entries[0], "type")).toBe("session");
    expect(at(entries[0], "id")).toBe(threadId);
    const messages = entries.filter((entry) => entry.type === "message");
    expect(messages.map((entry) => at(entry, "message", "role"))).toEqual(["user", "assistant", "toolResult", "assistant"]);
    expect(at(messages[0], "message", "content")).toEqual([{ type: "text", text: "SCENARIO:full please" }]);
    const toolCall = at(messages[1], "message", "content");
    expect(Array.isArray(toolCall) && toolCall.map((block) => at(block, "type"))).toEqual(["thinking", "toolCall"]);
    expect(at(messages[2], "message", "toolName")).toBe("eval");
    const final = at(messages[3], "message", "content");
    expect(Array.isArray(final) && str(at(final[0], "text"))).toContain("You picked **B**");
    entries.slice(1).forEach((entry, index) => {
      expect(entry.parentId).toBe(index === 0 ? null : entries[index]?.id);
    });
    const history = await client.request("thread/read", { threadId, includeTurns: true });
    expect(at(history, "thread", "turns")).toMatchObject([{ status: "completed" }]);
    expect(await client.close()).toBe(0);
  });

  it("lists, resumes, archives, forks and deletes threads from the session files after a relaunch", async () => {
    const box = await sandbox();
    const first = await box.launch();
    const threadId = await first.startThread(box.dir);
    const turnId = await first.startTurn(threadId, "Reply with exactly: pong");
    await first.waitTurnCompleted(turnId);
    expect(await first.close()).toBe(0);

    const second = await box.launch("log-second.jsonl");
    const listed = await second.request("thread/list", {});
    expect(at(listed, "data")).toMatchObject([{ id: threadId, preview: "Reply with exactly: pong", status: { type: "notLoaded" } }]);
    expect(await second.request("thread/loaded/list", {})).toEqual({ data: [], nextCursor: null });
    expect(await second.request("thread/resume", { threadId })).toMatchObject({ thread: { id: threadId }, model: "alpha", modelProvider: "fake" });
    expect(await second.request("thread/loaded/list", {})).toEqual({ data: [threadId], nextCursor: null });

    const forked = str(at(await second.request("thread/fork", { threadId, cwd: box.dir }), "thread", "id"));
    expect(forked).not.toBe(threadId);
    await second.request("thread/archive", { threadId });
    expect(at(await second.request("thread/list", {}), "data")).toMatchObject([{ id: forked, preview: "Reply with exactly: pong" }]);
    expect(at(await second.request("thread/list", { archived: true }), "data")).toMatchObject([{ id: threadId }]);
    await second.request("thread/unarchive", { threadId });
    await second.request("thread/delete", { threadId: forked });
    expect((at(await second.request("thread/list", {}), "data") as Frame[]).map((thread) => thread["id"])).toEqual([threadId]);
    expect(existsSync(join(box.home, "sessions", `${threadId}.jsonl`))).toBe(true);
    expect(await second.close()).toBe(0);
  });
});
