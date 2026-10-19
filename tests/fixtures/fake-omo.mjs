#!/usr/bin/env node
// Deterministic stand-in for the omo CLI: version, the multi-session Native RPC host, and the session-tree and catalog RPC.
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  utimesSync,
  watch,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { dirname, join, win32 } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { runDagScenario } from "./dag-scenario.mjs";

const VERSION_LINE = "omo 5.1.4-fake (engine: fake)";
const SERVER_VERSION = "5.1.4-fake";
const USAGE = "usage: fake-omo --version | fake-omo --mode rpc --multi-session --session-runtime in-process [--extension <path>]\n";
const MAX_SLOW_TICKS = 300;
const PERMISSION_OPTIONS = ["Allow once", "Allow always", "Deny", "Deny with feedback"];
// FAKE_OMO_DEMO names a JSON file with scripted presentation content for scripts/readme-media.mjs:
// { session?: { model, modelProvider }, models?: [...], scenes: [{ match, steps }], sideAnswers?: [{ match, reply, chunks?, chunkMs? }] }.
// A turn whose text contains a scene's `match` plays its steps (runDemoScene); tests never set the variable.
const DEMO = process.env.FAKE_OMO_DEMO === undefined ? null : JSON.parse(readFileSync(process.env.FAKE_OMO_DEMO, "utf8"));
const DEFAULT_MODEL = { provider: DEMO?.session?.modelProvider ?? "fake", id: DEMO?.session?.model ?? "alpha" };

// Durable session id -> session, and omo's per-connection routing handle (`rpc-N`) -> session.
const threads = new Map();
const handles = new Map();
const pendingResponses = new Map();
const timers = new Set();
const watchers = new Set();
let home = "";
let sessionsDir = "";
let logPath;
let nextHandle = 1;

/** A command refused with `success: false`, like omo's response envelope. */
class CommandFailure extends Error {
  constructor(message, errorCode) {
    super(message);
    this.errorCode = errorCode;
  }
}

class Interrupted extends Error {}

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const nowSec = () => Date.now() / 1000;

function write(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

/** One session record, tagged with the routing handle the client opened the session under. */
function event(record, type, fields = {}) {
  write({ type, sessionId: record.handle, ...fields });
}

function firstText(input) {
  for (const entry of input) {
    if (isRecord(entry) && entry.type === "text" && typeof entry.text === "string") return entry.text;
  }
  return "";
}

function splitInto(text, count) {
  const chunks = [];
  for (let i = 0; i < count; i += 1) {
    chunks.push(text.slice(Math.floor((i * text.length) / count), Math.floor(((i + 1) * text.length) / count)));
  }
  return chunks;
}

// ---- sessions and their files ----------------------------------------------------------------

function writeHeader(record) {
  mkdirSync(dirname(record.thread.path), { recursive: true });
  const header = {
    type: "session",
    version: 3,
    id: record.thread.id,
    timestamp: new Date(record.thread.createdAt * 1000).toISOString(),
    cwd: record.thread.cwd,
  };
  writeFileSync(record.thread.path, `${JSON.stringify(header)}\n`);
}

function recordEntry(record, entry) {
  if (!existsSync(record.thread.path)) writeHeader(record);
  const id = randomUUID().slice(0, 8);
  const line = { ...entry, id, parentId: record.lastEntryId, timestamp: new Date().toISOString() };
  appendFileSync(record.thread.path, `${JSON.stringify(line)}\n`);
  record.lastEntryId = id;
  return line;
}

const zeroUsage = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const userEntry = (text, images = []) => ({
  type: "message",
  message: { role: "user", content: [{ type: "text", text }, ...images], timestamp: Date.now() },
});

function expandSkills(text) {
  const blocks = new Map();
  let rest = text;
  while (rest.startsWith("/skill:")) {
    const token = /^\/skill:([\w-]+)(?:\s+|$)/.exec(rest);
    if (token === null || !DEFAULT_SKILLS.some((skill) => skill.name === token[1])) break;
    const name = token[1];
    if (!blocks.has(name)) {
      if (blocks.size === 5) break;
      const body = name === "ulw-loop" ? "Run the loop." : name === "mass-ulw" ? "Dispatch the workflow." : `Run ${name}.`;
      blocks.set(name, `<skill name="${name}" location="/fake/skills/${name}/SKILL.md">\nReferences are relative to /fake/skills/${name}.\n\n${body}\n</skill>`);
    }
    rest = rest.slice(token[0].length);
  }
  return blocks.size === 0 ? text : [...blocks.values(), ...(rest === "" ? [] : [rest])].join("\n\n");
}

const assistantEntry = (content, stopReason) => ({
  type: "message",
  message: {
    role: "assistant",
    content,
    api: "fake",
    provider: "fake",
    model: "alpha",
    usage: zeroUsage(),
    stopReason,
    timestamp: Date.now(),
  },
});

const toolResultEntry = (toolCallId, toolName, text, isError, details) => ({
  type: "message",
  message: {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    ...(details === undefined ? {} : { details }),
    isError,
    timestamp: Date.now(),
  },
});

function loadSession(file) {
  const lines = [];
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    if (raw.trim() === "") continue;
    try {
      lines.push(JSON.parse(raw));
    } catch (error) {
      process.stderr.write(`fake-omo: skipping unparseable session line in ${file}: ${error.message}\n`);
    }
  }
  const header = lines[0];
  if (!isRecord(header) || header.type !== "session" || typeof header.id !== "string") {
    throw new CommandFailure(`Not an omo session file: ${file}`, "invalid_session");
  }
  let lastEntryId = null;
  let name = null;
  for (const entry of lines.slice(1)) {
    if (!isRecord(entry)) continue;
    if (typeof entry.id === "string") lastEntryId = entry.id;
    if (entry.type === "session_info") name = typeof entry.name === "string" ? entry.name : null;
  }
  return {
    thread: { id: header.id, path: file, cwd: typeof header.cwd === "string" ? header.cwd : home, createdAt: Date.parse(String(header.timestamp)) / 1000, name },
    lastEntryId,
  };
}

/** FAKE_OMO_SEED_THREADS holds [{ id, cwd?, name?, preview?, createdAt?, updatedAt? }] (seconds); each seed is written once as a session file. */
function writeSeedSessions() {
  const seedFile = process.env.FAKE_OMO_SEED_THREADS;
  if (seedFile === undefined) return;
  const seeds = JSON.parse(readFileSync(seedFile, "utf8"));
  if (!Array.isArray(seeds)) throw new Error("FAKE_OMO_SEED_THREADS must hold a JSON array");
  for (const seed of seeds) {
    if (!isRecord(seed) || typeof seed.id !== "string") throw new Error("seed thread needs a string id");
    const path = join(sessionsDir, `${seed.id}.jsonl`);
    if (existsSync(path)) continue;
    const updatedAt = typeof seed.updatedAt === "number" ? seed.updatedAt : nowSec();
    const createdAt = typeof seed.createdAt === "number" ? seed.createdAt : updatedAt;
    const record = { thread: { id: seed.id, path, cwd: typeof seed.cwd === "string" ? seed.cwd : home, createdAt }, lastEntryId: null };
    writeHeader(record);
    if (typeof seed.preview === "string" && seed.preview !== "") recordEntry(record, userEntry(seed.preview));
    if (typeof seed.name === "string") recordEntry(record, { type: "session_info", name: seed.name });
    utimesSync(path, updatedAt, updatedAt);
  }
}

// omo's goal extension keeps one store per session beside the session file; times are Unix seconds.
const goalFile = (record) => join(dirname(record.thread.path), "extensions", "goal", `${record.thread.id}.json`);

function readGoal(record) {
  try {
    return JSON.parse(readFileSync(goalFile(record), "utf8")).goal ?? null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function writeGoal(record, goal) {
  const file = goalFile(record);
  if (goal === null) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ version: 1, goal: { id: randomUUID(), ...goal, threadId: record.thread.id } }));
  renameSync(temporary, file);
}

/**
 * The scenarios name what they publish in the app-server terms they were written in; this sends each one the way omo
 * does: extension events as `extension_event` records, goal changes as writes to the goal store.
 */
function notify(method, params, owner = threads.get(params.threadId)) {
  if (owner === undefined) throw new Error(`fake-omo: ${method} names no open session (${String(params.threadId)})`);
  switch (method) {
    case "extension_event":
      event(owner, "extension_event", { name: params.name, data: params.data });
      return;
    case "thread/goal/updated":
      writeGoal(owner, params.goal);
      return;
    case "thread/goal/cleared":
      writeGoal(owner, null);
      return;
    default:
      throw new Error(`fake-omo: no native record for ${method}`);
  }
}

/**
 * FAKE_OMO_LONG_SESSION is JSON { id, cwd, turns, toolCalls }. Before the threads are listed the fake records that
 * session once: every turn holds a user message, `toolCalls` eval calls with their results and a markdown answer, so a
 * test can open a conversation with tens of thousands of DOM nodes.
 */
function writeLongSession() {
  const raw = process.env.FAKE_OMO_LONG_SESSION;
  if (raw === undefined) return;
  const spec = JSON.parse(raw);
  if (!isRecord(spec) || typeof spec.id !== "string" || typeof spec.cwd !== "string" || !Number.isInteger(spec.turns) || !Number.isInteger(spec.toolCalls)) {
    throw new Error("FAKE_OMO_LONG_SESSION must be JSON { id, cwd, turns, toolCalls }");
  }
  const path = join(sessionsDir, `${spec.id}.jsonl`);
  if (existsSync(path)) return;
  const record = { thread: { id: spec.id, path, cwd: spec.cwd, createdAt: nowSec() - 3600 }, lastEntryId: null };
  for (let turn = 1; turn <= spec.turns; turn += 1) {
    recordEntry(record, userEntry(`Step ${turn}: check how the cart totals are computed.`));
    for (let call = 1; call <= spec.toolCalls; call += 1) {
      const id = `long-${turn}-${call}`;
      recordEntry(record, assistantEntry([{ type: "toolCall", id, name: "eval", arguments: { language: "js", code: `print(await run("grep -n total${call} src/lib/cart.ts"))` } }], "toolUse"));
      recordEntry(record, toolResultEntry(id, "eval", `src/lib/cart.ts:${call}: export const total${call} = subtotal + tax;`, false));
    }
    recordEntry(record, assistantEntry([{ type: "text", text: FLOOD_TEXT }], "stop"));
  }
}

// ---- turns ----------------------------------------------------------------------------------
function guard(turn, promise) {
  return Promise.race([
    promise,
    turn.interruptSignal.then(() => {
      throw new Interrupted();
    }),
  ]);
}

function sleep(turn, ms) {
  return guard(
    turn,
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        resolve();
      }, ms);
      timers.add(timer);
    }),
  );
}

/**
 * Resolves once `file` exists. The directory is watched before the first existence check, so a release that landed
 * in between is still seen; interrupting the turn closes the watcher and throws Interrupted, like sleep.
 */
function awaitFile(turn, file) {
  return guard(
    turn,
    new Promise((resolve, reject) => {
      const watcher = watch(dirname(file), () => {
        if (existsSync(file)) finish(resolve);
      });
      watchers.add(watcher);
      const finish = (settle, value) => {
        watcher.close();
        watchers.delete(watcher);
        settle(value);
      };
      watcher.on("error", (error) => finish(reject, error));
      void turn.interruptSignal.then(() => finish(() => {}));
      if (existsSync(file)) finish(resolve);
    }),
  );
}

/** Raises one extension UI dialog and resolves with the client's `extension_ui_response`. */
async function uiRequest(record, fields, turn = null) {
  const id = randomUUID();
  const answer = new Promise((resolve) => pendingResponses.set(id, resolve));
  event(record, "extension_ui_request", { id, ...fields });
  try {
    const response = await (turn === null ? answer : guard(turn, answer));
    if (fields.method === "question") event(record, "question_resolved", { id, toolCallId: fields.toolCallId, outcome: response.cancelled === true ? "cancelled" : "answered" });
    return response;
  } catch (error) {
    if (error instanceof Interrupted && fields.method === "question") event(record, "question_resolved", { id, toolCallId: fields.toolCallId, outcome: "cancelled" });
    throw error;
  } finally {
    pendingResponses.delete(id);
  }
}

/** omo's permission prompt for a bash call, answered in the app-server approval terms the scenarios check. */
async function askApproval(turn, { itemId, command }) {
  const call = { toolCallId: itemId };
  const choice = await uiRequest(turn.record, { method: "select", title: `Permission required: bash\n\nCommand: $ ${command}`, options: PERMISSION_OPTIONS, ...call }, turn);
  const value = choice.cancelled === true ? undefined : choice.value;
  if (value === "Allow once") return { decision: "accept" };
  if (value === "Allow always") return { decision: "acceptForSession" };
  if (value === "Deny with feedback") {
    const feedback = await uiRequest(turn.record, { method: "input", title: "Feedback", placeholder: "Why are you denying this permission? (optional)", ...call }, turn);
    return { decision: "decline", ...(typeof feedback.value === "string" && feedback.value !== "" ? { reason: feedback.value } : {}) };
  }
  return { decision: value === "Deny" ? "decline" : "cancel" };
}

/** omo's `question` dialog; the answer comes back as `{ answers: { <id>: { answers: string[] } } }`. */
async function askQuestions(turn, { itemId, questions, timeoutMs = 600000 }) {
  const response = await uiRequest(turn.record, {
    method: "question", toolCallId: itemId, waitForAnswer: true, timeout: timeoutMs,
    questions: questions.map(({ id, header = "", question, options = [], multiSelect = false }) => ({ id, header, question, options, multiSelect })),
  }, turn);
  if (response.cancelled === true || !isRecord(response.answers)) return {};
  return {
    answers: Object.fromEntries(Object.entries(response.answers).map(([id, answer]) => [id, {
      answers: [...(Array.isArray(answer?.selected) ? answer.selected : []), ...(typeof answer?.text === "string" && answer.text !== "" ? [answer.text] : [])],
    }])),
  };
}

const nextItemId = (turn) => `item-${++turn.itemSeq}`;

const assistantMessage = (content, stopReason, extra = {}) => ({
  role: "assistant", content, api: "fake", provider: "fake", model: "alpha", usage: zeroUsage(), stopReason, timestamp: Date.now(), ...extra,
});

function messageUpdate(turn, assistantMessageEvent) {
  event(turn.record, "message_update", { message: { role: "assistant" }, assistantMessageEvent });
}

function toolResult(text, details) {
  return { content: [{ type: "text", text }], ...(details === undefined ? {} : { details }) };
}

/** Starts the native records for one wire item: an assistant message for text and reasoning, a tool execution for calls. */
function startItem(turn, item) {
  const record = turn.record;
  switch (item.type) {
    case "agentMessage":
      event(record, "message_start", { message: assistantMessage([], "stop") });
      messageUpdate(turn, { type: "text_start", contentIndex: 0 });
      return;
    case "reasoning":
      event(record, "message_start", { message: assistantMessage([], "toolUse") });
      messageUpdate(turn, { type: "thinking_start", contentIndex: 0 });
      return;
    case "dynamicToolCall":
      event(record, "tool_execution_start", { toolCallId: item.id, toolName: item.tool, args: item.arguments });
      return;
    case "commandExecution":
      event(record, "tool_execution_start", { toolCallId: item.id, toolName: "bash", args: { command: item.command } });
      return;
    default:
      throw new Error(`fake-omo: no native record for a ${item.type} item`);
  }
}

function finishItem(turn, item, stopReason = "stop") {
  const record = turn.record;
  switch (item.type) {
    case "agentMessage":
      messageUpdate(turn, { type: "text_end", contentIndex: 0, content: item.text });
      event(record, "message_end", { message: assistantMessage([{ type: "text", text: item.text }], stopReason) });
      return;
    case "reasoning": {
      const thinking = item.content.join("\n");
      messageUpdate(turn, { type: "thinking_end", contentIndex: 0, content: thinking });
      event(record, "message_end", { message: assistantMessage([{ type: "thinking", thinking }], "toolUse") });
      return;
    }
    case "dynamicToolCall": {
      const text = (item.contentItems ?? []).map((content) => content.text).join("");
      event(record, "tool_execution_end", { toolCallId: item.id, toolName: item.tool, result: toolResult(text, item.details), isError: item.success === false });
      return;
    }
    case "commandExecution":
      event(record, "tool_execution_end", {
        toolCallId: item.id, toolName: "bash", result: toolResult(item.aggregatedOutput ?? "", { exitCode: item.exitCode }), isError: item.status !== "completed",
      });
      return;
    default:
      throw new Error(`fake-omo: no native record for a ${item.type} item`);
  }
}

function openAgentMessage(turn) {
  const item = { type: "agentMessage", id: nextItemId(turn), text: "" };
  startItem(turn, item);
  return item;
}

function appendAgentDelta(turn, item, delta) {
  item.text += delta;
  messageUpdate(turn, { type: "text_delta", contentIndex: 0, delta });
}

function reasoningDelta(turn, delta) {
  messageUpdate(turn, { type: "thinking_delta", contentIndex: 0, delta });
}

function closeAgentMessage(record, turn, item, stopReason) {
  finishItem(turn, item, stopReason);
  const entry = assistantEntry([{ type: "text", text: item.text }], stopReason);
  if (item.text === "echo: usage-turn") entry.message.usage = { ...zeroUsage(), input: 24000, output: 1000, totalTokens: 25000 };
  recordEntry(record, entry);
}

async function runEcho(record, turn, text) {
  const reply = text.includes("pong") ? "pong" : `echo: ${text}`;
  const item = openAgentMessage(turn);
  const [head, tail] = splitInto(reply, 2);
  appendAgentDelta(turn, item, head);
  await sleep(turn, 50);
  appendAgentDelta(turn, item, tail);
  closeAgentMessage(record, turn, item, "stop");
}

async function runSlow(record, turn) {
  const item = openAgentMessage(turn);
  try {
    for (let tick = 1; tick <= MAX_SLOW_TICKS; tick += 1) {
      await sleep(turn, 200);
      appendAgentDelta(turn, item, `tick ${tick} `);
    }
  } catch (error) {
    if (!(error instanceof Interrupted)) throw error;
  }
  closeAgentMessage(record, turn, item, turn.interrupted ? "aborted" : "stop");
}

function firstAnswer(response) {
  const q1 = isRecord(response) && isRecord(response.answers) ? response.answers.q1 : undefined;
  const answers = isRecord(q1) && Array.isArray(q1.answers) ? q1.answers : [];
  return answers.find((answer) => typeof answer === "string") ?? "(none)";
}

async function runFull(record, turn) {
  const reasoning = { type: "reasoning", id: nextItemId(turn), content: [] };
  startItem(turn, reasoning);
  for (const delta of ["Planning the ", "demo ", "answer."]) reasoningDelta(turn, delta);
  reasoning.content = ["Planning the demo answer."];
  finishItem(turn, reasoning);

  const tool = {
    type: "dynamicToolCall",
    id: nextItemId(turn),
    tool: "eval",
    arguments: { language: "js", code: "1+1", summary: "Add numbers" },
    contentItems: null,
    success: null,
  };
  startItem(turn, tool);
  recordEntry(
    record,
    assistantEntry(
      [
        { type: "thinking", thinking: reasoning.content.join("\n") },
        { type: "toolCall", id: tool.id, name: tool.tool, arguments: tool.arguments },
      ],
      "toolUse",
    ),
  );

  const { decision } = await askApproval(turn, { itemId: tool.id, command: "rm -rf /tmp/fake-demo" });
  const accepted = decision === "accept" || decision === "acceptForSession";
  const resultText = accepted ? '{"text":"2"}' : "declined by user";
  tool.success = accepted;
  tool.contentItems = [{ type: "inputText", text: resultText }];
  finishItem(turn, tool);
  recordEntry(record, toolResultEntry(tool.id, tool.tool, resultText, !accepted));

  const response = await askQuestions(turn, {
    itemId: "question-1",
    questions: [{
      id: "q1", header: "Pick", question: "Which option?",
      options: [{ label: "A", description: "first" }, { label: "B", description: "second" }],
    }],
  });

  const reply = `# Demo\n\n- one\n- two\n\n\`\`\`ts\nconst answer: number = 42;\n\`\`\`\n\nYou picked **${firstAnswer(response)}**.`;
  const item = openAgentMessage(turn);
  for (const chunk of splitInto(reply, 6)) appendAgentDelta(turn, item, chunk);
  closeAgentMessage(record, turn, item, "stop");
}

/** Asks one multi-select question and confirms the first chosen option. */
async function runMultiQuestion(record, turn) {
  const response = await askQuestions(turn, {
    itemId: `question-${turn.itemSeq}`,
    questions: [{
      id: "q1", header: "Checks", question: "Which checks should run?", multiSelect: true,
      options: [{ label: "Unit", description: "vitest" }, { label: "E2E", description: "Playwright" }],
    }],
  });
  const item = openAgentMessage(turn);
  appendAgentDelta(turn, item, `Running **${firstAnswer(response)}**.`);
  closeAgentMessage(record, turn, item, "stop");
}

const FLOOD_TEXT = [
  "## Checking the cart totals\n\n",
  "Totals come from `cartTotals` in `src/lib/cart.ts`: each line adds `price * quantity` in integer cents, ",
  "and tax is rounded once on the subtotal, so three items at 1006 cents give 241 cents of tax.\n\n",
  "| Case | Subtotal | Tax | Total |\n|---|---|---|---|\n| one item | 5000 | 400 | 5400 |\n| three items | 3018 | 241 | 3259 |\n\n",
  "```ts\nexport function cartTotals(items: CartItem[]): Totals {\n  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);\n",
  "  const tax = Math.round(subtotal * 0.08);\n  return { subtotal, tax, total: subtotal + tax };\n}\n```\n\n",
].join("");
const FLOOD_CHUNKS = FLOOD_TEXT.match(/[\s\S]{1,12}/g);

/**
 * Streams a long markdown answer as many small deltas, the way a busy turn does:
 * SCENARIO:flood[:<chunks>[:<intervalMs>]], 1500 chunks every 10 ms by default. Every 25th chunk ends with a
 * ⟦<index>@<send time in ms>⟧ marker, so a test can tell how far the rendered text lags behind the stream.
 */
async function runFlood(record, turn, text) {
  const [, chunks = "1500", intervalMs = "10"] = /SCENARIO:flood(?::(\d+))?(?::(\d+))?/.exec(text) ?? [];
  const item = openAgentMessage(turn);
  try {
    for (let index = 0; index < Number(chunks); index += 1) {
      await sleep(turn, Number(intervalMs));
      const chunk = FLOOD_CHUNKS[index % FLOOD_CHUNKS.length];
      appendAgentDelta(turn, item, index % 25 === 24 ? `${chunk}⟦${index}@${Date.now()}⟧` : chunk);
    }
  } catch (error) {
    if (!(error instanceof Interrupted)) throw error;
  }
  closeAgentMessage(record, turn, item, turn.interrupted ? "aborted" : "stop");
}

const SIDE_MARKER = "[OmO UI side chat background]";

/** Answers an OmO UI side chat's first message, naming its question and how much main context it carried. */
async function runSide(record, turn, text) {
  const question = (/\nSide question: ([\s\S]*)$/.exec(text)?.[1] ?? "").trim();
  const users = [...text.matchAll(/<user>\n([\s\S]*?)\n<\/user>/g)].map((match) => match[1]);
  const assistants = [...text.matchAll(/<assistant>\n/g)].length;
  const demo = DEMO?.sideAnswers?.find((entry) => question.includes(entry.match));
  const reply = demo !== undefined
    ? demo.reply
    : users.length === 0
      ? `Side answer to "${question}" without main context.`
      : `Side answer to "${question}" from ${users.length + assistants} main messages; the first main request was "${users[0]}".`;
  const item = openAgentMessage(turn);
  for (const chunk of splitInto(reply, demo?.chunks ?? 3)) {
    appendAgentDelta(turn, item, chunk);
    await sleep(turn, demo?.chunkMs ?? 40);
  }
  closeAgentMessage(record, turn, item, "stop");
}

/** A DAG run in the omo.dag.updated fields; counts, edges and waves are derived from the scripted nodes. */
function demoRun(dag, at) {
  const counts = { total: dag.nodes.length, pending: 0, blocked: 0, scheduled: 0, running: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 };
  for (const node of dag.nodes) counts[node.state] += 1;
  const byId = new Map(dag.nodes.map((node) => [node.id, node]));
  const depth = (node) => Math.max(-1, ...(node.depends_on ?? []).map((id) => depth(byId.get(id)))) + 1;
  const waves = [];
  for (const node of dag.nodes) (waves[depth(node)] ??= []).push(node.id);
  const started = (state) => state === "running" || state === "completed" || state === "failed";
  return {
    run_id: dag.run_id ?? "demo-run", run_key: dag.run_key ?? "demo", name: dag.name, status: dag.status ?? "running",
    created_at: at, updated_at: at, counts,
    nodes: dag.nodes.map((node) => ({
      depends_on: [], attempt: 1, created_at: at,
      ...(started(node.state) ? { started_at: at } : {}),
      ...(node.state === "completed" || node.state === "failed" ? { completed_at: at } : {}),
      ...node,
    })),
    edges: dag.nodes.flatMap((node) => (node.depends_on ?? []).map((from) => ({ from, to: node.id }))),
    waves: waves.map((nodeIds, index) => ({ index, node_ids: nodeIds })),
  };
}

/** A child task in the omo.task.updated fields; `live_progress.elapsedMs` backdates its start. */
function demoTask(task, at) {
  const { live_progress: progress, ...rest } = task;
  return {
    execution_mode: "in-process", depth: 1, created_at: at, updated_at: at,
    residency_state: task.status === "running" ? "resident" : "disposed",
    ...rest,
    ...(progress === undefined ? {} : { live_progress: { ...progress, started_at: Date.now() - (progress.elapsedMs ?? 0) } }),
  };
}

/**
 * Plays one FAKE_OMO_DEMO scene. Steps: { wait }, { reasoning }, { item, done?, ms? } (a dynamicToolCall or
 * commandExecution item, completed with `done`), { command: { command, output, exitCode, ms?, approval? } }, { question },
 * { todo: phases, durationMs? }, { goal }, { dag }, { dagActivity }, { tasks }, { say, chunks?, chunkMs? } ("{{answer}}" becomes
 * the last question's answer) and { hold } (waits for fake.advance or an interrupt).
 */
async function runDemoScene(record, turn, scene) {
  const threadId = record.thread.id;
  const extension = (name, data) => notify("extension_event", { threadId, name, data });
  let answer = "";
  for (const step of scene.steps) {
    const at = new Date().toISOString();
    if ("wait" in step) await sleep(turn, step.wait);
    else if ("reasoning" in step) {
      const item = { type: "reasoning", id: nextItemId(turn), content: [] };
      startItem(turn, item);
      for (const delta of splitInto(step.reasoning, 4)) {
        reasoningDelta(turn, delta);
        await sleep(turn, 60);
      }
      item.content = [step.reasoning];
      finishItem(turn, item);
    } else if ("item" in step) {
      const item = { id: nextItemId(turn), ...step.item };
      startItem(turn, item);
      await sleep(turn, step.ms ?? 0);
      Object.assign(item, step.done ?? {});
      finishItem(turn, item);
    } else if ("command" in step) {
      const { command, output, exitCode, ms, approval } = step.command;
      const item = { type: "commandExecution", id: nextItemId(turn), command, status: "inProgress", aggregatedOutput: null, exitCode: null };
      startItem(turn, item);
      let accepted = true;
      if (approval !== undefined) {
        const { decision } = await askApproval(turn, { itemId: item.id, command });
        accepted = decision === "accept" || decision === "acceptForSession";
      }
      await sleep(turn, accepted ? ms ?? 0 : 0);
      Object.assign(item, accepted ? { status: "completed", aggregatedOutput: output, exitCode } : { status: "declined" });
      finishItem(turn, item);
    } else if ("question" in step) {
      answer = firstAnswer(await askQuestions(turn, { itemId: `question-${turn.itemSeq}`, questions: [{ id: "q1", ...step.question }] }));
    } else if ("todo" in step) {
      const tool = { type: "dynamicToolCall", id: nextItemId(turn), tool: "todo", arguments: { op: "init" }, contentItems: null, success: null };
      startItem(turn, tool);
      recordEntry(record, assistantEntry([{ type: "toolCall", id: tool.id, name: "todo", arguments: tool.arguments }], "toolUse"));
      recordEntry(record, { type: "custom", customType: "senpi.todo-state", data: { schema: "v2", phases: step.todo } });
      recordEntry(record, toolResultEntry(tool.id, "todo", "Todo saved", false));
      Object.assign(tool, { success: true, contentItems: [{ type: "inputText", text: "Todo saved" }] });
      finishItem(turn, tool);
    } else if ("goal" in step) {
      notify("thread/goal/updated", { threadId, goal: { tokensUsed: 0, timeUsedSeconds: 0, createdAt: Math.floor(nowSec()), updatedAt: Math.floor(nowSec()), ...step.goal } });
    } else if ("dag" in step) extension("omo.dag.updated", { parent_session_id: threadId, runs: [demoRun(step.dag, at)] });
    else if ("dagActivity" in step) extension("omo.dag.activity", { schemaVersion: 1, at, ...step.dagActivity });
    else if ("tasks" in step) extension("omo.task.updated", { parent_session_id: threadId, tasks: step.tasks.map((task) => demoTask(task, at)) });
    else if ("say" in step) {
      const item = openAgentMessage(turn);
      for (const chunk of splitInto(step.say.replaceAll("{{answer}}", answer), step.chunks ?? 8)) {
        appendAgentDelta(turn, item, chunk);
        await sleep(turn, step.chunkMs ?? 60);
      }
      closeAgentMessage(record, turn, item, "stop");
    } else if ("hold" in step) {
      await guard(turn, new Promise((resolve) => {
        record.advanceLive = () => {
          record.advanceLive = null;
          resolve();
        };
      }));
    } else throw new Error(`unknown demo step ${JSON.stringify(step)}`);
  }
}

function runScenario(record, turn, text) {
  if (text.startsWith(SIDE_MARKER)) return runSide(record, turn, text);
  const scene = DEMO?.scenes?.find((candidate) => text.includes(candidate.match));
  if (scene !== undefined) return runDemoScene(record, turn, scene);
  // The DAG fixture names child sessions as event owners; omo publishes every one of them on the parent session.
  const dagNotify = (method, params) => notify(method, params, record);
  if (text.includes("SCENARIO:omo-live")) return runLive(record, turn);
  if (text.includes("SCENARIO:workflow-background")) {
    const tool = { type: "dynamicToolCall", id: nextItemId(turn), tool: "read", arguments: { path: "shared/protocol.ts" }, contentItems: null, success: null };
    startItem(turn, tool);
    recordEntry(record, assistantEntry([{ type: "toolCall", id: tool.id, name: "read", arguments: tool.arguments }], "toolUse"));
    Object.assign(tool, { success: true, contentItems: [{ type: "inputText", text: "Runtime dependency contract checked." }] });
    finishItem(turn, tool);
    recordEntry(record, toolResultEntry(tool.id, "read", "Runtime dependency contract checked.", false));
    const message = openAgentMessage(turn);
    appendAgentDelta(turn, message, "Background workflow started. You can continue this conversation.");
    closeAgentMessage(record, turn, message, "stop");
    return runDagScenario(record, turn, { home, notify: dagNotify, guard, background: true });
  }
  if (text.includes("SCENARIO:dag")) return runDagScenario(record, turn, { home, notify: dagNotify, guard });
  if (text === "SCENARIO:skills-history") {
    const item = openAgentMessage(turn);
    appendAgentDelta(turn, item, "Built the thing.");
    closeAgentMessage(record, turn, item, "stop");
    recordEntry(record, {
      type: "custom_message",
      customType: "omo-mass-ulw:skill-pointer",
      content: "<omo-mass-ulw-pointer>Hidden skill pointer.</omo-mass-ulw-pointer>",
      display: false,
    });
    return;
  }
  // SCENARIO:live-notice: a displayable custom_message entry and a fallback model switch, announced live.
  if (text.includes("SCENARIO:live-notice")) {
    const item = openAgentMessage(turn);
    appendAgentDelta(turn, item, "Noticed.");
    closeAgentMessage(record, turn, item, "stop");
    const entry = recordEntry(record, { type: "custom_message", customType: "omo-kibitzer:recall", display: true, content: "<recalled-memory source=\"[[notes/live.md]]\">Live recall line.</recalled-memory>" });
    event(record, "entry_appended", { entry });
    event(record, "entry_appended", { entry });
    event(record, "model_changed", { model: { provider: "fake", id: "beta" }, thinkingLevel: "high", source: "fallback" });
    return;
  }
  // SCENARIO:retry: a transient error stop, an auto-retry delay, then a recovered answer in the same turn.
  if (text.includes("SCENARIO:retry")) {
    event(record, "message_end", { message: assistantMessage([], "error", { errorMessage: "529 overloaded" }) });
    event(record, "auto_retry_start", { attempt: 1, maxAttempts: 3, delayMs: 800, errorMessage: "529 overloaded" });
    event(record, "agent_end", { messages: [], willRetry: true });
    return sleep(turn, 800).then(() => {
      event(record, "auto_retry_end", { success: true, attempt: 1 });
      const item = openAgentMessage(turn);
      appendAgentDelta(turn, item, "recovered");
      closeAgentMessage(record, turn, item, "stop");
    });
  }
  if (text.includes("SCENARIO:silent-error")) {
    const entry = assistantEntry([{ type: "text", text: "" }], "error");
    entry.message.errorMessage = "402: Insufficient Balance";
    entry.message.model = "fake-model";
    recordEntry(record, entry);
    return;
  }
  if (text.includes("SCENARIO:full")) return runFull(record, turn);
  if (text.includes("SCENARIO:extension-ui")) {
    // A generic select dialog plus fire-and-forget notify / setStatus / set_editor_text; the chosen option is echoed.
    event(record, "extension_ui_request", { id: randomUUID(), method: "notify", message: "Extension says hello", notifyType: "warning" });
    event(record, "extension_ui_request", { id: randomUUID(), method: "setStatus", statusKey: "demo", statusText: "demo status" });
    event(record, "extension_ui_request", { id: randomUUID(), method: "set_editor_text", text: "text from extension" });
    return uiRequest(record, { method: "select", title: "Pick a flavor", options: ["Vanilla", "Mint"] }, turn).then((response) => {
      const item = openAgentMessage(turn);
      appendAgentDelta(turn, item, `Flavor: ${response.cancelled === true ? "none" : response.value}`);
      closeAgentMessage(record, turn, item, "stop");
    });
  }
  if (text.includes("SCENARIO:async-question")) {
    // A non-blocking question: omo raises it, the turn ends at once, and the question is withdrawn with the turn.
    const id = randomUUID();
    event(record, "extension_ui_request", {
      id, method: "question", toolCallId: "async-question", waitForAnswer: false,
      questions: [{ id: "choice", header: "Choice", question: "Pick A or B?", options: [{ label: "A", description: "First" }, { label: "B", description: "Second" }], multiSelect: false }],
    });
    const item = openAgentMessage(turn);
    appendAgentDelta(turn, item, "The question is waiting for your answer.");
    closeAgentMessage(record, turn, item, "stop");
    event(record, "question_resolved", { id, toolCallId: "async-question", outcome: "cancelled" });
    return;
  }
  // SCENARIO:gate:<file> streams nothing until <file> exists, then echoes: a test holds the turn open for as long as it
  // needs (switch threads, change a setting) and releases it by creating the file, with no timing assumption.
  if (text.includes("SCENARIO:gate:")) {
    const gate = /SCENARIO:gate:(.+)$/m.exec(text)?.[1]?.trim();
    if (gate === undefined || gate === "") throw new Error("SCENARIO:gate needs a file path");
    return awaitFile(turn, gate).then(() => runEcho(record, turn, text));
  }
  // SCENARIO:quiet[:ms] streams nothing for ms (default 3000) before echoing, like a long model call with hidden thinking.
  if (text.includes("SCENARIO:quiet")) {
    return sleep(turn, Number(/SCENARIO:quiet:(\d+)/.exec(text)?.[1] ?? 3000)).then(() => runEcho(record, turn, text));
  }
  if (text.includes("SCENARIO:slow")) return runSlow(record, turn);
  if (text.includes("SCENARIO:multi-question")) return runMultiQuestion(record, turn);
  if (text.includes("SCENARIO:flood")) return runFlood(record, turn, text);
  return runEcho(record, turn, text);
}

/** Records a background task spawn the way omo does: a task tool call whose result details carry the spawn receipt. */
function recordTaskSpawn(record, turn, id) {
  const receipt = {
    task_id: `task-${id}`, run_epoch: 0, status: "running", mode: "spawn", task_summary: `Execute ${id}`, name: `Lane ${id}`,
    category: "quick", execution_mode: "in-process", run_in_background: true,
    resolved_model: { source: "category", provider: "fake", model_id: "alpha", display: "fake/alpha" },
  };
  const text = `Started task Lane ${id} (task-${id}, running).`;
  const tool = { type: "dynamicToolCall", id: nextItemId(turn), namespace: null, tool: "task", arguments: { category: "quick", prompt: `Execute ${id}`, run_in_background: true }, status: "inProgress", contentItems: null, success: null, durationMs: null };
  startItem(turn, tool);
  recordEntry(record, assistantEntry([{ type: "toolCall", id: tool.id, name: "task", arguments: tool.arguments }], "toolUse"));
  recordEntry(record, toolResultEntry(tool.id, "task", text, false, receipt));
  Object.assign(tool, { status: "completed", success: true, contentItems: [{ type: "inputText", text }], durationMs: 0 });
  finishItem(turn, tool);
}

/** Records the wake message omo appends when a background task settles; its details carry the completion record. */
function recordTaskCompletion(record, completion) {
  recordEntry(record, {
    type: "custom_message", customType: "omo-senpi:wake", content: `Task ${completion.task_id} ${completion.status}`, display: false,
    details: [{ customType: "senpi-task.completion", details: [completion] }],
  });
}

function emitLiveStage(record, turn, stage) {
  const threadId = record.thread.id;
  const at = new Date().toISOString();
  const states = stage === 1 ? ["running", "blocked", "blocked"] : stage === 2 ? ["completed", "running", "scheduled"] : ["completed", "failed", "skipped"];
  const nodes = ["A", "B", "C"].map((id, index) => ({
    id, label: `Lane ${id}`, prompt: `Execute ${id}`, depends_on: id === "A" ? [] : ["A"],
    state: states[index], attempt: 1, created_at: at,
    ...(states[index] === "running" || states[index] === "completed" || states[index] === "failed" ? { task_id: `task-${id}`, started_at: at } : {}),
    ...(states[index] === "completed" || states[index] === "failed" ? { completed_at: at } : {}),
    ...(states[index] === "failed" ? { last_error: { code: "provider_error", message: "402: Insufficient Balance" } } : {}),
  }));
  const counts = { total: 3, pending: 0, blocked: 0, scheduled: 0, running: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 };
  for (const state of states) counts[state] += 1;
  const extension = (name, data) => notify("extension_event", { type: "extension_event", threadId, name, data });
  extension("omo.dag.updated", { parent_session_id: threadId, runs: [{
    run_id: "mass-ulw-display", run_key: "display", name: "mass-ulw display", status: stage === 3 ? "failed" : "running",
    created_at: at, updated_at: at, ...(stage === 3 ? { completed_at: at } : {}), counts, nodes,
    edges: [{ from: "A", to: "B" }, { from: "A", to: "C" }], waves: [{ index: 0, node_ids: ["A"] }, { index: 1, node_ids: ["B", "C"] }],
  }] });
  const task = (id, status) => ({
    task_id: `task-${id}`, name: `Lane ${id}`, task_summary: `Execute ${id}`, status,
    execution_mode: "in-process", model: "fake/alpha", residency_state: status === "running" ? "resident" : "disposed",
    depth: 1, created_at: at, updated_at: at,
    ...(status === "running" ? { live_progress: { activity: "working", started_at: Date.now(), current_tool: "read", turns: 1, tool_calls: 1 } } : {}),
    ...(status === "completed" ? { final_response: "A completed", run_stats: { runtime_ms: 10, turns: 1, tool_calls: 1 } } : {}),
    ...(status === "error" ? { error_message: "402: Insufficient Balance", failure_kind: "provider_error" } : {}),
  });
  extension("omo.task.updated", { parent_session_id: threadId, tasks: stage === 1 ? [task("A", "running")] : [task("A", "completed"), task("B", stage === 2 ? "running" : "error")] });
  if (stage === 1) {
    record.goal = { threadId, objective: "Ship the OmO UI app", status: "active", tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: nowSec(), updatedAt: nowSec() };
    notify("thread/goal/updated", { threadId, turnId: null, goal: record.goal });
    recordTaskSpawn(record, turn, "A");
  }
  if (stage === 2) {
    extension("omo.dag.activity", { schemaVersion: 1, runId: "mass-ulw-display", nodeId: "B", taskId: "task-B", at, activity: "implementing", currentTool: "edit", turns: 2, toolCalls: 3 });
    recordTaskCompletion(record, { task_id: "task-A", status: "completed", name: "Lane A", model: "fake/alpha", final_response: "A completed" });
    recordTaskSpawn(record, turn, "B");
    const tool = { type: "dynamicToolCall", id: nextItemId(turn), namespace: null, tool: "todo", arguments: { op: "init" }, status: "inProgress", contentItems: null, success: null, durationMs: null };
    startItem(turn, tool);
    recordEntry(record, assistantEntry([{ type: "toolCall", id: tool.id, name: "todo", arguments: tool.arguments }], "toolUse"));
    recordEntry(record, { type: "custom", customType: "senpi.todo-state", data: { schema: "v2", phases: [
      { name: "Implementation", tasks: [{ content: "Implement A", status: "completed" }] },
      { name: "Verification", tasks: [{ content: "Verify B", status: "abandoned" }, { content: "Report results", status: "pending" }] },
    ] } });
    recordEntry(record, toolResultEntry(tool.id, "todo", "Todo saved", false));
    tool.status = "completed";
    tool.success = true;
    tool.contentItems = [{ type: "inputText", text: "Todo saved" }];
    tool.durationMs = 0;
    finishItem(turn, tool);
  }
  if (stage === 3) {
    recordTaskCompletion(record, { task_id: "task-B", status: "error", name: "Lane B", model: "fake/alpha", error_message: "402: Insufficient Balance" });
    record.goal = null;
    notify("thread/goal/cleared", { threadId });
  }
}

function runLive(record, turn) {
  let stage = 1;
  emitLiveStage(record, turn, stage);
  return guard(turn, new Promise((resolve) => {
    record.advanceLive = () => {
      if (stage >= 3) return;
      stage += 1;
      emitLiveStage(record, turn, stage);
      if (stage === 3) {
        record.advanceLive = null;
        resolve();
      }
    };
  }));
}

function createTurn(record) {
  let interrupt = () => {};
  const interruptSignal = new Promise((resolve) => {
    interrupt = resolve;
  });
  let finished = () => {};
  const done = new Promise((resolve) => {
    finished = resolve;
  });
  return {
    threadId: record.thread.id,
    record,
    itemSeq: 0,
    interrupted: false,
    interruptSignal,
    interrupt() {
      this.interrupted = true;
      interrupt();
    },
    done,
    finished,
  };
}

const SKILLS_HISTORY_TEXT = 'The user explicitly invoked the "ulw-loop" and "mass-ulw" skills. Follow the instructions in <skill-instruction> as binding for this request, while respecting higher-priority instructions.\n\n'
  + '<skill-instruction name="ulw-loop" location="/fake/skills/ulw-loop/SKILL.md">Run the loop. Literal <skill-instruction example> stays text.</skill-instruction>\n\n'
  + '<skill-instruction name="mass-ulw" location="/fake/skills/mass-ulw/SKILL.md">Dispatch the workflow.</skill-instruction>\n\n'
  + '<user-request>build the thing</user-request>\n'
  + '<omo-ulw-loop-pointer>Follow the synthetic loop. Literal <omo-example stays text.</omo-ulw-loop-pointer>\n'
  + '<system-reminder>Keep the synthetic context.</system-reminder>';

/**
 * One agent run, in the records omo emits: agent_start, the user message, the scenario's messages and tool calls, then
 * agent_end and agent_settled. SCENARIO:lost-completion drops agent_settled; SCENARIO:silent-end drops both, so the client
 * still believes the run is going and its next steer is refused.
 */
async function runTurn(record, turn, text, images) {
  event(record, "agent_start");
  const user = { role: "user", content: [{ type: "text", text }, ...images], timestamp: Date.now() };
  event(record, "message_start", { message: user });
  event(record, "message_end", { message: user });
  recordEntry(record, userEntry(text === "SCENARIO:skills-history" ? SKILLS_HISTORY_TEXT : expandSkills(text), images));

  let failure = null;
  try {
    await runScenario(record, turn, text);
  } catch (error) {
    if (!(error instanceof Interrupted)) failure = error instanceof Error ? error.message : String(error);
  }
  if (turn.interrupted) record.queue = [];
  else await deliverQueued(record);
  record.activeTurn = null;
  if (failure !== null) event(record, "message_end", { message: assistantMessage([], "error", { errorMessage: failure }) });
  if (!text.includes("SCENARIO:silent-end")) {
    event(record, "agent_end", { messages: [] });
    if (!text.includes("SCENARIO:lost-completion")) event(record, "agent_settled");
  }
  turn.finished();
}

/** omo's `queue_update`: the pending steering/follow-up texts plus the ordered rows that carry each queuedId. */
function queueUpdate(record) {
  const queue = record.queue ?? [];
  event(record, "queue_update", {
    steering: queue.filter((entry) => entry.mode === "steer").map((entry) => entry.text),
    followUp: queue.filter((entry) => entry.mode === "follow_up").map((entry) => entry.text),
    ordered: queue.map((entry) => ({ queuedId: entry.queuedId, mode: entry.mode, text: entry.text })),
  });
}

/** Follow-ups are delivered as user messages once the run has nothing left to do. */
async function deliverQueued(record) {
  while ((record.queue ?? []).length > 0) {
    const next = record.queue.shift();
    queueUpdate(record);
    const user = { role: "user", content: [{ type: "text", text: next.text }], timestamp: Date.now() };
    event(record, "message_start", { message: user });
    event(record, "message_end", { message: user });
    recordEntry(record, userEntry(next.text));
  }
}

// ---- commands -----------------------------------------------------------------------------

const MODELS = DEMO?.models ?? [
  { id: "fake/alpha", model: "alpha", displayName: "Fake Alpha" },
  { id: "fake/beta", model: "beta", displayName: "Fake Beta" },
  ...[
    ["anthropic-subscription", "claude-opus-5-5", "Claude Opus 5.5"],
    ["anthropic-subscription", "claude-fable-5-1", "Claude Fable 5.1"],
    ["chatgpt-subscription", "gpt-6-astra", "GPT-6 Astra"],
    ["chatgpt-subscription", "gpt-6-sol-fast", "GPT-6 Sol Fast"],
  ].map(([provider, model, displayName]) => ({ id: `${provider}/${model}`, model, displayName })),
];

/** A get_available_models row: omo's Model object, keyed by provider and bare id. */
function nativeModel(model) {
  const cut = model.id.indexOf("/");
  return {
    id: model.model, provider: cut > 0 ? model.id.slice(0, cut) : DEFAULT_MODEL.provider, name: model.displayName,
    reasoning: true, supportedThinkingLevels: ["off", "low", "medium", "high", "xhigh"], defaultThinkingLevel: "medium", contextWindow: 128000,
  };
}

// Secret-free descriptors like omo's account/providerAccounts/read; pin and remove change them in memory.
const providerAccounts = {
  "anthropic-subscription": [
    { name: "work", source: "login", blocked: false, pinned: false },
    { name: "old", source: "login", blocked: true, pinned: false },
  ],
};

const DEFAULT_SKILLS = [
  { name: "ulw-loop", description: "Run a goal-driven loop.", scope: "system", enabled: true },
  { name: "mass-ulw", description: "Run dependency-ordered workflows.", scope: "system", enabled: true },
  { name: "plan", description: "Plan the requested work.", scope: "user", enabled: true },
  { name: "user-only-skill", description: "Invoke explicitly as a user.", scope: "user", enabled: false },
  { name: "long-description-skill", description: "L".repeat(400), scope: "user", enabled: true },
].map((skill) => ({ ...skill, path: `/fake/skills/${skill.name}/SKILL.md` }));

// FAKE_OMO_SKILLS names each cwd's skills in the wire fields: { data: [{ cwd, skills: [{ name, description, path, scope, enabled }] }] }.
function skillCommands(record) {
  const configured = process.env.FAKE_OMO_SKILLS === undefined ? null : JSON.parse(process.env.FAKE_OMO_SKILLS);
  const skills = configured?.data.find((entry) => entry.cwd === record.thread.cwd)?.skills ?? DEFAULT_SKILLS;
  return skills.map((skill) => ({
    name: `skill:${skill.name}`, description: skill.description, source: "skill", syntax: "slash", filePath: skill.path,
    sourceInfo: { path: skill.path, scope: skill.scope === "repo" ? "project" : skill.scope }, disableModelInvocation: skill.enabled === false,
  }));
}

function sessionState(record) {
  return {
    sessionId: record.thread.id,
    sessionFile: record.thread.path,
    cwd: record.thread.cwd,
    model: { provider: record.settings.provider, id: record.settings.modelId, name: record.settings.modelId },
    thinkingLevel: record.settings.thinkingLevel,
    isStreaming: record.activeTurn !== null,
    isCompacting: false,
    messageCount: 0,
    pendingMessageCount: 0,
    ...(record.thread.name ? { sessionName: record.thread.name } : {}),
  };
}

function openSession(frame) {
  const settings = {
    provider: typeof frame.provider === "string" ? frame.provider : DEFAULT_MODEL.provider,
    modelId: typeof frame.modelId === "string" ? frame.modelId : DEFAULT_MODEL.id,
    thinkingLevel: "medium",
  };
  let record;
  if (typeof frame.sessionPath === "string" && existsSync(frame.sessionPath)) {
    record = [...threads.values()].find((open) => open.thread.path === frame.sessionPath) ?? { ...loadSession(frame.sessionPath), activeTurn: null, settings };
  } else {
    const id = randomUUID();
    const cwd = typeof frame.cwd === "string" ? frame.cwd : home;
    const path = typeof frame.sessionPath === "string" ? frame.sessionPath : join(sessionsDir, `${id}.jsonl`);
    record = { thread: { id, path, cwd, createdAt: nowSec(), name: null }, lastEntryId: null, activeTurn: null, settings };
    recordEntry(record, { type: "model_change", provider: settings.provider, modelId: settings.modelId });
    // Stands in for the app's extension, which marks sessions opened with its context label.
    if (isRecord(frame.context) && frame.context.created_by === "omo-ui") {
      recordEntry(record, { type: "custom", customType: "omo-ui.origin", data: { createdBy: "omo-ui", surface: frame.context.surface ?? "desktop" } });
    }
  }
  record.handle = `rpc-${nextHandle++}`;
  threads.set(record.thread.id, record);
  handles.set(record.handle, record);
  return { sessionId: record.handle, state: sessionState(record) };
}

async function goalCommand(record, args) {
  const current = readGoal(record);
  const now = Math.floor(nowSec());
  if (args === "") return;
  if (args === "clear") {
    writeGoal(record, null);
    return;
  }
  if (args === "pause" || args === "resume") {
    if (current === null) throw new CommandFailure("No goal is set", "no_goal");
    writeGoal(record, { ...current, status: args === "pause" ? "paused" : "active", updatedAt: now });
    return;
  }
  if (current !== null && current.status !== "complete") {
    const choice = await uiRequest(record, { method: "select", title: `Replace goal?\n\nCurrent goal: ${current.objective}`, options: ["Replace current goal", "Cancel"] });
    if (choice.value !== "Replace current goal") return;
  }
  writeGoal(record, { objective: args, status: "active", tokensUsed: 0, timeUsedSeconds: 0, createdAt: now, updatedAt: now });
}

async function prompt(frame, record, reply) {
  const message = typeof frame.message === "string" ? frame.message : "";
  const goal = /^\/goal(?:\s+([\s\S]*))?$/.exec(message.trim());
  if (goal !== null) {
    await goalCommand(record, (goal[1] ?? "").trim());
    reply({ disposition: "handled" });
    return;
  }
  if (record.activeTurn !== null) throw new CommandFailure("Agent is already processing a prompt", "already_streaming");
  if (message.includes("SCENARIO:fail")) throw new CommandFailure("Simulated turn failure", "simulated_failure");
  const images = Array.isArray(frame.images) ? frame.images.filter(isRecord) : [];
  if (typeof frame.clientMessageId === "string") {
    recordEntry(record, { type: "custom", customType: "rpc_client_message_admission", data: { clientMessageId: frame.clientMessageId, durableSessionId: record.thread.id } });
  }
  const turn = createTurn(record);
  record.activeTurn = turn;
  reply({});
  runTurn(record, turn, message, images).catch((error) => {
    process.stderr.write(`fake-omo: turn crashed: ${error instanceof Error ? error.stack : String(error)}\n`);
  });
}

function waitForFile(file) {
  return new Promise((resolve) => {
    const check = () => {
      if (existsSync(file)) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        check();
      }, 50);
      timers.add(timer);
    };
    check();
  });
}

async function handleCommand(frame, record, reply) {
  switch (frame.type) {
    case "get_protocol_info": {
      const gate = process.env.FAKE_OMO_INIT_GATE;
      if (gate) await waitForFile(gate);
      reply({ mode: "multi", serverVersion: SERVER_VERSION, protocolVersion: 1 });
      return;
    }
    case "set_client_info":
      reply({});
      return;
    case "open_session":
      reply(openSession(frame));
      return;
    default:
      break;
  }
  if (record === undefined) {
    if (typeof frame.sessionId !== "string") throw new CommandFailure(`${frame.type} needs a sessionId`, "missing_session_id");
    throw new CommandFailure(`Unknown session: ${frame.sessionId}`, "unknown_session");
  }
  switch (frame.type) {
    case "get_state":
      reply(sessionState(record));
      return;
    case "prompt":
      await prompt(frame, record, reply);
      return;
    case "steer": {
      if (record.activeTurn === null) throw new CommandFailure("No agent run to steer", "not_streaming");
      const message = typeof frame.message === "string" ? frame.message : "";
      reply({});
      const user = { role: "user", content: [{ type: "text", text: message }], timestamp: Date.now() };
      event(record, "message_start", { message: user });
      event(record, "message_end", { message: user });
      recordEntry(record, userEntry(message));
      return;
    }
    case "follow_up": {
      if (record.activeTurn === null) throw new CommandFailure("No agent run to follow up", "not_streaming");
      const message = typeof frame.message === "string" ? frame.message : "";
      record.queueSeq = (record.queueSeq ?? 0) + 1;
      (record.queue ??= []).push({ queuedId: `q_${record.queueSeq}`, mode: "follow_up", text: message });
      reply({ disposition: "queued" });
      queueUpdate(record);
      return;
    }
    case "dequeue_message":
    case "edit_queued_message": {
      const queued = (record.queue ?? []).find((entry) => entry.queuedId === frame.queuedId);
      if (queued === undefined) {
        reply({ queuedId: frame.queuedId, status: "not_found" });
        return;
      }
      if (frame.type === "dequeue_message") record.queue.splice(record.queue.indexOf(queued), 1);
      else queued.text = String(frame.text);
      reply({ queuedId: frame.queuedId, status: frame.type === "dequeue_message" ? "removed" : "edited" });
      queueUpdate(record);
      return;
    }
    case "abort": {
      const turn = record.activeTurn;
      if (turn !== null) {
        turn.interrupt();
        await turn.done;
      }
      reply({});
      return;
    }
    case "set_session_name":
      record.thread.name = String(frame.name);
      recordEntry(record, { type: "session_info", name: record.thread.name });
      reply({});
      return;
    case "set_model":
      record.settings.provider = String(frame.provider);
      record.settings.modelId = String(frame.modelId);
      recordEntry(record, { type: "model_change", provider: record.settings.provider, modelId: record.settings.modelId });
      reply(sessionState(record).model);
      return;
    case "set_thinking_level":
      record.settings.thinkingLevel = String(frame.level);
      recordEntry(record, { type: "thinking_level_change", thinkingLevel: record.settings.thinkingLevel });
      reply({});
      return;
    case "close_session":
      record.activeTurn?.interrupt();
      handles.delete(record.handle);
      reply({});
      return;
    case "compact": {
      // Shaped like omo 5.1.35: the session file gets a compaction entry, the events carry the result.
      const result = { summary: "## Kept\n- the open plan\n- the last answer", firstKeptEntryId: record.lastEntryId, tokensBefore: 150000, estimatedTokensAfter: 32000 };
      event(record, "compaction_start", { reason: "manual" });
      recordEntry(record, { type: "compaction", summary: result.summary, firstKeptEntryId: result.firstKeptEntryId, tokensBefore: result.tokensBefore, details: {} });
      event(record, "compaction_end", { reason: "manual", result, aborted: false, willRetry: false });
      reply(result);
      return;
    }
    case "get_available_models":
      reply({ models: MODELS.map(nativeModel) });
      return;
    case "get_commands":
      reply({ commands: skillCommands(record) });
      return;
    case "get_loaded_surfaces":
      reply({ extensions: [], mcpServers: process.env.FAKE_OMO_MCP_EMPTY === "1" ? [] : [
        { name: "demo-tools", toolCount: 3, status: "connected", authStatus: "unsupported" },
        { name: "pganalyze", toolCount: 0, status: "failed", authStatus: "notLoggedIn" },
      ] });
      return;
    case "get_provider_accounts": {
      const provider = String(frame.provider);
      reply({ provider, accounts: providerAccounts[provider] ?? [] });
      return;
    }
    case "account_pin": {
      const accounts = providerAccounts[String(frame.provider)] ?? [];
      for (const account of accounts) account.pinned = account.name === frame.name;
      reply({});
      return;
    }
    case "account_remove": {
      const provider = String(frame.provider);
      providerAccounts[provider] = (providerAccounts[provider] ?? []).filter((account) => account.name !== frame.name);
      // Like omo, removal also drops the stored credential from auth.json.
      const authFile = join(home, "auth.json");
      if (existsSync(authFile)) {
        const auth = JSON.parse(readFileSync(authFile, "utf8"));
        const pool = auth[provider]?.accounts;
        if (Array.isArray(pool)) auth[provider].accounts = pool.filter((account) => account?.name !== frame.name);
        writeFileSync(authFile, JSON.stringify(auth));
      }
      reply({});
      return;
    }
    case "extension_request":
      if (frame.name === "omo-ui.task.send") {
        reply({ delivered: true });
        return;
      }
      if (frame.name === "omo-ui.task.cancel") {
        reply({ cancelled: true });
        record.cancelTask?.(frame.data?.taskId);
        return;
      }
      if (frame.name !== "fake.advance") throw new CommandFailure(`No extension request handler named ${String(frame.name)}`, "not_found");
      record.advanceLive?.();
      reply({});
      return;
    default:
      throw new CommandFailure(`Unknown command: ${String(frame.type)}`, "unknown_command");
  }
}

function onLine(line) {
  if (line.trim() === "") return;
  let frame;
  try {
    frame = JSON.parse(line);
  } catch (error) {
    process.stderr.write(`fake-omo: unparseable command line: ${error.message}\n`);
    return;
  }
  if (!isRecord(frame)) return;
  const record = typeof frame.sessionId === "string" ? handles.get(frame.sessionId) : undefined;
  // The log adds the durable session id so tests can find a thread's commands by the id the app shows.
  if (logPath !== undefined) appendFileSync(logPath, `${JSON.stringify(record === undefined ? frame : { ...frame, threadId: record.thread.id })}\n`);
  if (frame.type === "extension_ui_response") {
    pendingResponses.get(frame.id)?.(frame);
    return;
  }
  const reply = (data) => write({ id: frame.id, type: "response", command: frame.type, success: true, data });
  handleCommand(frame, record, reply).catch((error) => {
    if (!(error instanceof CommandFailure)) process.stderr.write(`fake-omo: ${String(frame.type)} crashed: ${error instanceof Error ? error.stack : String(error)}\n`);
    write({ id: frame.id, type: "response", command: frame.type, success: false, error: error instanceof Error ? error.message : String(error), ...(error.errorCode ? { errorCode: error.errorCode } : {}) });
  });
}

function serve() {
  home = process.env.FAKE_OMO_HOME ?? mkdtempSync(join(tmpdir(), "fake-omo-"));
  sessionsDir = join(home, "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  logPath = process.env.FAKE_OMO_LOG;
  writeLongSession();
  writeSeedSessions();
  process.stderr.write("fake omo rpc host ready\n");
  if (process.env.FAKE_OMO_SHARED === "1" && logPath !== undefined) appendFileSync(logPath, `${JSON.stringify({ type: "fake_shared_host_connection" })}\n`);
  const lines = createInterface({ input: process.stdin });
  lines.on("line", onLine);
  lines.on("close", () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const watcher of watchers) watcher.close();
    watchers.clear();
    process.exitCode = 0;
  });
}

function serveTree(file) {
  const entries = readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((entry) => entry.type !== "session");
  let leafId = entries.at(-1)?.id ?? null;
  logPath = process.env.FAKE_OMO_LOG;
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    const frame = JSON.parse(line);
    if (logPath !== undefined) appendFileSync(logPath, `${JSON.stringify(frame)}\n`);
    const reply = (data) => write({ id: frame.id, type: "response", command: frame.type, success: true, data });
    const reject = (error, errorCode, errorData) => write({ id: frame.id, type: "response", command: frame.type, success: false, error, errorCode, ...(errorData === undefined ? {} : { errorData }) });
    switch (frame.type) {
      case "get_tree": {
        const nodes = new Map(entries.map((entry) => [entry.id, { entry, children: [] }]));
        const tree = [];
        for (const node of nodes.values()) {
          const parent = nodes.get(node.entry.parentId);
          if (parent === undefined) tree.push(node);
          else parent.children.push(node);
        }
        reply({ tree, leafId });
        break;
      }
      case "navigate_tree": {
        if (frame.expectedLeafId !== undefined && frame.expectedLeafId !== leafId) {
          reject("Session leaf changed", "stale_leaf", { leafId });
          break;
        }
        const entry = entries.find((entry) => entry.id === frame.entryId);
        if (entry === undefined) {
          reject("Session entry not found", "entry_not_found");
          break;
        }
        const user = entry.type === "message" && entry.message?.role === "user";
        leafId = user ? entry.parentId : entry.id;
        reply({ outcome: "navigated", leafId, ...(user ? { editorText: firstText(entry.message.content) } : {}) });
        break;
      }
      case "extension_request": {
        if (frame.name === "omo-ui.task.cancel") { reply({ cancelled: true }); break; }
        if (frame.name !== "omoui.tree.persist") {
          reject("Extension not found", "not_found");
          break;
        }
        const entry = { type: "custom", customType: "omoui.tree.selection", data: {}, id: randomUUID().slice(0, 8), parentId: leafId, timestamp: new Date().toISOString() };
        appendFileSync(file, `${JSON.stringify(entry)}\n`);
        entries.push(entry);
        leafId = entry.id;
        reply({});
        break;
      }
      default:
        reject("Command not found", "not_found");
    }
  });
  lines.on("close", () => { process.exitCode = 0; });
}

function serveCatalog() {
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    const frame = JSON.parse(line);
    write({ type: "extension_ui_request", method: "setStatus", message: "catalog ready" });
    const reply = (data) => write({ id: frame.id, type: "response", command: frame.type, success: true, data });
    if (frame.type === "get_commands") {
      reply({ commands: [
        { name: "todo", description: "Track work", source: "extension", syntax: "slash" },
        { name: "review", source: "prompt", syntax: "slash" },
        { name: "skill:ulw-loop", description: "Run a loop", source: "skill", syntax: "dollar" },
        { name: "builtin", source: "builtin", syntax: "slash" },
        { name: "bad-syntax", source: "extension", syntax: "other" },
      ] });
    } else if (frame.type === "get_available_models") {
      reply({ models: [
        { id: "fake-model", provider: "fake", contextWindow: 128000 },
        ...MODELS.map((model) => ({ id: model.model, provider: "fake", contextWindow: 128000 })),
        { id: "invalid", provider: "fake", contextWindow: 0 },
        { id: "fraction", provider: "fake", contextWindow: 1.5 },
      ] });
    }
  });
  lines.on("close", () => { process.exitCode = 0; });
}

// The shared host mirrors omo's socket transport: <socket>.secret holds 32 bytes, win32 listens on a named pipe derived from
// the normalized lower-cased path and that secret, and every connection sends the secret before its first JSONL line.
function sharedSocketPath() {
  return join(process.env.FAKE_OMO_HOME ?? tmpdir(), "rpc", "rpc.sock");
}

function pipeAddress(socket, secret) {
  if (process.platform !== "win32") return socket;
  const canonical = win32.normalize(socket).toLowerCase();
  return `\\\\.\\pipe\\senpi-rpc-${createHash("sha256").update(Buffer.concat([Buffer.from(canonical, "utf8"), secret])).digest("hex").slice(0, 32)}`;
}

function hostEnsure() {
  const answer = (value, code) => { process.stdout.write(`${JSON.stringify(value)}\n`); process.exitCode = code; };
  if (process.env.FAKE_OMO_HOST_ENSURE === "fail") {
    answer({ action: "error", reason: "host_error", detail: "fake shared host refused" }, 1);
    return;
  }
  const socket = sharedSocketPath();
  mkdirSync(dirname(socket), { recursive: true });
  if (!existsSync(`${socket}.secret`)) writeFileSync(`${socket}.secret`, randomBytes(32));
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--fake-shared-host", socket], {
    detached: true, stdio: ["ignore", "pipe", "ignore"], env: process.env, windowsHide: true,
  });
  child.stdout.once("data", () => {
    child.stdout.destroy();
    child.unref();
    answer({ action: "start", socket, pid: child.pid, instanceId: "fake-shared-host", generation: 0, reused: false, upgradeable: false }, 0);
  });
  child.once("exit", (code) => answer({ action: "error", reason: "host_error", detail: `fake shared host exited with ${code}` }, 1));
}

/** Serves each authenticated connection with its own stdio fake host and exits once the last connection closes. */
function serveSharedHost(socket) {
  const secret = readFileSync(`${socket}.secret`);
  let live = 0;
  const idle = setTimeout(() => process.exit(0), 120_000);
  const server = createServer((connection) => {
    let received = Buffer.alloc(0);
    const onData = (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (received.length < secret.length) return;
      connection.off("data", onData);
      if (!received.subarray(0, secret.length).equals(secret)) { connection.destroy(); return; }
      clearTimeout(idle);
      live++;
      const host = spawn(process.execPath, [fileURLToPath(import.meta.url), ...hostArgs], { env: { ...process.env, FAKE_OMO_SHARED: "1" }, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
      const rest = received.subarray(secret.length);
      if (rest.length > 0) host.stdin.write(rest);
      connection.pipe(host.stdin);
      host.stdout.pipe(connection);
      host.stdin.on("error", () => undefined);
      connection.on("error", () => undefined);
      let ended = false;
      const end = () => {
        if (ended) return;
        ended = true;
        host.kill();
        connection.destroy();
        if (--live === 0) server.close(() => process.exit(0));
      };
      connection.once("close", end);
      host.once("exit", end);
    };
    connection.on("data", onData);
  });
  server.listen(pipeAddress(socket, secret), () => process.stdout.write("ready\n"));
}

const argv = process.argv.slice(2);
const hostArgs = ["--mode", "rpc", "--multi-session", "--session-runtime", "in-process"];
if (argv[0] === "host" && argv[1] === "ensure") {
  hostEnsure();
} else if (argv.length === 2 && argv[0] === "--fake-shared-host") {
  serveSharedHost(argv[1]);
} else if (argv.length === 1 && argv[0] === "--version") {
  process.stdout.write(`${VERSION_LINE}\n`);
} else if ((argv.length === 5 || (argv.length === 7 && argv[5] === "--extension")) && hostArgs.every((arg, index) => argv[index] === arg)) {
  serve();
} else if (argv.length === 7 && argv[0] === "--mode" && argv[1] === "rpc" && argv[2] === "--session" && argv[4] === "--no-extensions" && argv[5] === "--extension") {
  serveTree(argv[3]);
} else if (argv.length === 4 && argv[0] === "--mode" && argv[1] === "rpc" && argv[2] === "--no-session" && argv[3] === "--offline") {
  serveCatalog();
} else {
  process.stderr.write(USAGE);
  process.exitCode = 2;
}
