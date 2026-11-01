import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { OmoBinary, SessionTreeOperation as SharedOperation, SessionTreeResult as SharedResult } from "../../shared/ipc";
import type { SpawnImpl } from "./app-server-client";
import { JsonlDecoder } from "./jsonl";
import { ManagedChild } from "./managed-child";
import type { StopTimeouts } from "./managed-child";

export type SessionTreeOperation = Extract<SharedOperation, { type: "list" | "navigate" | "edit" }>;

export interface SessionTreeOptions {
  binary: OmoBinary;
  env: Record<string, string>;
  sessionPath: string;
  cwd: string;
  extensionPath: string;
  operation: SessionTreeOperation;
  startTimeoutMs?: number;
  requestTimeoutMs?: number;
  stopTimeoutsMs?: StopTimeouts;
  spawnImpl?: SpawnImpl;
}

export interface SessionTreeResult extends SharedResult {
  editorText?: string;
  aborted?: boolean;
  summaryEntryId?: string;
}

/** Retains the native error envelope, including stale_leaf's current leaf. */
export class SessionTreeRpcError extends Error {
  constructor(
    message: string,
    readonly command: string,
    readonly errorCode?: string,
    readonly errorData?: unknown,
  ) {
    super(message);
    this.name = "SessionTreeRpcError";
  }
}

type RecordValue = Record<string, unknown>;
interface TreeNode {
  entry: RecordValue & { id: string; type: string; parentId: string | null };
  children: TreeNode[];
  label?: string;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLeafId(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function malformed(command: string): SessionTreeRpcError {
  return new SessionTreeRpcError(`omo returned a malformed ${command} response`, command, "malformed_response");
}

function parseTree(value: unknown): { tree: TreeNode[]; leafId: string | null } {
  if (!isRecord(value) || !Array.isArray(value["tree"]) || !isLeafId(value["leafId"])) throw malformed("get_tree");
  const roots: TreeNode[] = [];
  const pending: { raw: unknown; destination: TreeNode[] }[] = value["tree"].map((raw) => ({ raw, destination: roots })).reverse();
  const ids = new Set<string>();
  while (pending.length) {
    const item = pending.pop()!;
    const raw = item.raw;
    if (!isRecord(raw) || !isRecord(raw["entry"]) || !Array.isArray(raw["children"])) throw malformed("get_tree");
    const entry = raw["entry"];
    if (typeof entry["id"] !== "string" || typeof entry["type"] !== "string" || !isLeafId(entry["parentId"]) || ids.has(entry["id"])) throw malformed("get_tree");
    if (raw["label"] !== undefined && typeof raw["label"] !== "string") throw malformed("get_tree");
    if (entry["type"] === "message" && (!isRecord(entry["message"]) || typeof entry["message"]["role"] !== "string")) throw malformed("get_tree");
    ids.add(entry["id"]);
    const node: TreeNode = { entry: { ...entry, id: entry["id"], type: entry["type"], parentId: entry["parentId"] }, children: [] };
    if (typeof raw["label"] === "string") node.label = raw["label"];
    item.destination.push(node);
    for (const child of [...raw["children"]].reverse()) pending.push({ raw: child, destination: node.children });
  }
  if (value["leafId"] !== null && !ids.has(value["leafId"])) throw malformed("get_tree");
  return { tree: roots, leafId: value["leafId"] };
}

function text(content: unknown): string {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.flatMap((block) => isRecord(block) && block["type"] === "text" && typeof block["text"] === "string" ? [block["text"]] : []).join("\n") : "";
}

const LABEL_LIMIT = 60;

function plain(markdown: string): string {
  const line = markdown.replace(/```[\s\S]*?```/g, " ").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~#>|]/g, "").replace(/\s+/g, " ").trim();
  return line.length > LABEL_LIMIT ? `${line.slice(0, LABEL_LIMIT - 1).trimEnd()}…` : line;
}

function normalizeTree(value: unknown): SessionTreeResult {
  const { tree, leafId } = parseTree(value);
  const branches = new Map<string, { entryId: string; label: string; active: boolean }>();
  const nodes: SessionTreeResult["nodes"] = [];
  let activeId: string | null = null;
  const pending = tree.map((node) => ({ node, meaningful: null as TreeNode | null, label: undefined as string | undefined })).reverse();
  while (pending.length) {
    const { node, meaningful: previous, label: previousLabel } = pending.pop()!;
    const message = node.entry["message"];
    const role = isRecord(message) && typeof message["role"] === "string" ? message["role"] : null;
    const content = isRecord(message) ? message["content"] : node.entry["content"];
    const nodeText = text(content);
    nodes.push({
      entryId: node.entry.id,
      parentId: node.entry.parentId,
      type: node.entry.type,
      role,
      label: node.label ?? (plain(nodeText) || role || node.entry.type),
      // Only assistant text is editable; tool output belongs to the transcript, not the cached navigation tree.
      ...(node.entry.type === "message" && role === "assistant" ? { text: nodeText } : role === "user" && nodeText ? { text: nodeText } : {}),
    });
    const conversation = node.entry.type === "custom_message" || (node.entry.type === "message" && isRecord(message) && (message["role"] === "user" || message["role"] === "assistant"));
    const bookkeepingNotice = node.entry.type === "custom_message" && typeof node.entry["customType"] === "string" && /^(omo-model-profile:|senpi-)/.test(node.entry["customType"]);
    const meaningful = conversation && (!bookkeepingNotice || previous === null) ? node : previous;
    const label = node.label ?? previousLabel;
    if (node.entry.id === leafId) activeId = meaningful?.entry.id ?? null;
    if (!node.children.length && meaningful) {
      const entry = meaningful.entry;
      const content = isRecord(entry["message"]) ? entry["message"]["content"] : entry["content"];
      const fallback = isRecord(entry["message"]) ? String(entry["message"]["role"]) : "custom_message";
      branches.set(entry.id, { entryId: entry.id, label: label ?? (plain(text(content)) || fallback), active: false });
    }
    for (const child of [...node.children].reverse()) pending.push({ node: child, meaningful, label });
  }
  for (const branch of branches.values()) branch.active = branch.entryId === activeId;
  return { leafId, branches: [...branches.values()], nodes };
}

/** Opening RPC appends runtime bindings; those are not a concurrent conversation edit. */
function navigationLeaf(value: unknown, expected: string | null | undefined): string | null | undefined {
  if (expected === undefined) return expected;
  const { tree, leafId } = parseTree(value);
  const entries = new Map<string, TreeNode["entry"]>();
  const pending = [...tree];
  while (pending.length) { const node = pending.pop()!; entries.set(node.entry.id, node.entry); pending.push(...node.children); }
  let id = leafId;
  while (id !== expected) {
    if (id === null) return expected;
    const entry = entries.get(id);
    if (!entry || entry.type === "message" || (entry.type === "custom_message" && !(typeof entry["customType"] === "string" && /^(omo-model-profile:|senpi-)/.test(entry["customType"])))) return expected;
    id = entry.parentId;
  }
  return leafId;
}

/** Uses file order for the durable leaf; metadata descendants fold into their conversation tail. */
export function parseSessionTree(source: string): SessionTreeResult {
  const parser = new SessionTreeParser();
  for (const line of source.split(/\r?\n/)) parser.add(line);
  return parser.result();
}

/** Builds the same tree from complete streamed records without allocating a whole-file string. */
export class SessionTreeParser {
  private readonly entries = new Map<string, TreeNode>();
  private readonly labels = new Map<string, string>();
  private leafId: string | null = null;

  add(line: string): void {
    if (!line.trim()) return;
    let value: unknown;
    try { value = JSON.parse(line); }
    catch { return; } // Live session files can end with a partially written line.
    if (!isRecord(value) || value["type"] === "session") return;
    if (typeof value["id"] !== "string" || typeof value["type"] !== "string" || !isLeafId(value["parentId"])) throw malformed("get_tree");
    const message = value["message"];
    // Tree consumers need text and parent links, not tool details, usage or base64 images.
    const entry: TreeNode["entry"] = { id: value["id"], type: value["type"], parentId: value["parentId"], customType: value["customType"] };
    if (isRecord(message)) {
      const content = text(message["content"]);
      entry["message"] = { role: message["role"], content: message["role"] === "assistant" || message["role"] === "user" ? content : plain(content) };
    } else entry["content"] = plain(text(value["content"]));
    const node: TreeNode = { entry, children: [] };
    if (this.entries.has(node.entry.id)) throw malformed("get_tree");
    this.entries.set(node.entry.id, node);
    this.leafId = node.entry.id;
    if (value["type"] === "label" && typeof value["targetId"] === "string" && typeof value["label"] === "string") this.labels.set(value["targetId"], value["label"]);
  }

  result(): SessionTreeResult {
    const roots: TreeNode[] = [];
    // A retained parser can project repeatedly after appends; links are derived, never accumulated.
    for (const node of this.entries.values()) node.children = [];
    for (const node of this.entries.values()) {
      const parent = node.entry.parentId === null ? undefined : this.entries.get(node.entry.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node);
      node.label = this.labels.get(node.entry.id);
    }
    return normalizeTree({ tree: roots, leafId: this.leafId });
  }
}

export async function readSessionTree(sessionPath: string): Promise<SessionTreeResult> {
  return parseSessionTree(await readFile(sessionPath, "utf8"));
}

function parseNavigation(value: unknown): Pick<SessionTreeResult, "leafId" | "outcome" | "editorText" | "aborted" | "summaryEntryId"> {
  if (!isRecord(value) || !isLeafId(value["leafId"]) || (value["outcome"] !== "navigated" && value["outcome"] !== "cancelled")) throw malformed("navigate_tree");
  if ((value["editorText"] !== undefined && typeof value["editorText"] !== "string") || (value["aborted"] !== undefined && typeof value["aborted"] !== "boolean") || (value["summaryEntryId"] !== undefined && typeof value["summaryEntryId"] !== "string")) throw malformed("navigate_tree");
  return { ...value, leafId: value["leafId"], outcome: value["outcome"] };
}

function parseEdit(value: unknown): NonNullable<SessionTreeResult["edit"]> {
  if (!isRecord(value) || !isLeafId(value["leafId"])) throw malformed("edit_assistant_message");
  if (value["outcome"] === "edited") {
    if (!isRecord(value["entry"]) || typeof value["entry"]["id"] !== "string") throw malformed("edit_assistant_message");
    return { outcome: "edited", leafId: value["leafId"], entry: value["entry"] };
  }
  if (value["outcome"] === "unchanged") return { outcome: "unchanged", leafId: value["leafId"] };
  if (value["outcome"] === "cancelled" && (value["aborted"] === undefined || typeof value["aborted"] === "boolean")) {
    return { outcome: "cancelled", leafId: value["leafId"], ...(value["aborted"] !== undefined ? { aborted: value["aborted"] } : {}) };
  }
  throw malformed("edit_assistant_message");
}

/** The caller must fully stop app-server before opening the same session here. Never starts a turn. */
export async function runSessionTree(options: SessionTreeOptions): Promise<SessionTreeResult> {
  const args = ["--mode", "rpc", "--session", options.sessionPath, "--no-extensions", "--extension", options.extensionPath];
  const nodeScript = process.platform === "win32" && /\.mjs$/i.test(options.binary.path);
  const processChild = (options.spawnImpl ?? spawn)(nodeScript ? process.execPath : options.binary.path, nodeScript ? [options.binary.path, ...args] : args, {
    cwd: options.cwd,
    env: nodeScript ? { ...options.env, ELECTRON_RUN_AS_NODE: "1" } : options.env,
    stdio: "pipe",
    windowsHide: true,
  });
  let nextId = 0;
  let failure: Error | null = null;
  let pending: { id: string; command: string; resolve: (data: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout } | null = null;
  const reject = (error: Error): void => {
    failure = error;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      pending = null;
    }
  };
  const child = new ManagedChild(processChild, (code, signal) => {
    reject(new SessionTreeRpcError(`omo session tree exited (${signal ?? code ?? "spawn failure"})${child.stderrTail ? `: ${child.stderrTail.trim()}` : ""}`, pending?.command ?? "get_tree", "process_exit", { exitCode: code, signal, stderrTail: child.stderrTail }));
  });
  const decoder = new JsonlDecoder({
    onMalformed: () => reject(malformed(pending?.command ?? "get_tree")),
    onFrame: (value) => {
      if (!isRecord(value) || typeof value["type"] !== "string") { reject(malformed(pending?.command ?? "get_tree")); return; }
      if (value["type"] === "extension_ui_request") {
        if (["notify", "setStatus", "setWidget", "setTitle", "set_editor_text"].includes(String(value["method"]))) return;
        reject(new SessionTreeRpcError("omo session tree requested interactive input", pending?.command ?? "get_tree", "interactive_request"));
        return;
      }
      if (value["type"] !== "response") return;
      const request = pending;
      if (!request || value["id"] !== request.id) return;
      if (value["command"] !== request.command || typeof value["success"] !== "boolean") { reject(malformed(request.command)); return; }
      if (!value["success"]) {
        if (typeof value["error"] !== "string" || (value["errorCode"] !== undefined && typeof value["errorCode"] !== "string")) { reject(malformed(request.command)); return; }
        reject(new SessionTreeRpcError(value["error"], request.command, value["errorCode"], value["errorData"]));
        return;
      }
      clearTimeout(request.timer);
      pending = null;
      request.resolve(value["data"]);
    },
  });
  processChild.stdout.on("data", (chunk: Buffer) => decoder.push(chunk));
  processChild.stdout.on("end", () => decoder.end());
  const request = (command: string, data: RecordValue = {}, timeoutMs = options.requestTimeoutMs ?? 20_000): Promise<unknown> => {
    if (failure) return Promise.reject(failure);
    const id = `tree-${++nextId}`;
    return new Promise((resolve, rejectRequest) => {
      const timer = setTimeout(() => reject(new SessionTreeRpcError(`${command} timed out after ${timeoutMs} ms`, command, "timeout")), timeoutMs);
      pending = { id, command, resolve, reject: rejectRequest, timer };
      try { processChild.stdin.write(`${JSON.stringify({ id, type: command, ...data })}\n`); }
      catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
    });
  };
  let result: SessionTreeResult;
  try {
    const initialTree = await request("get_tree", {}, options.startTimeoutMs ?? 20_000);
    result = normalizeTree(initialTree);
    if (options.operation.type === "navigate") {
      const { entryId, intent, expectedLeafId } = options.operation;
      const guardedLeafId = navigationLeaf(initialTree, expectedLeafId);
      const navigation = parseNavigation(await request("navigate_tree", { entryId, ...(intent === "resume" ? { intent } : {}), ...(guardedLeafId !== undefined ? { expectedLeafId: guardedLeafId } : {}) }));
      if (navigation.outcome === "navigated") await request("extension_request", { name: "omoui.tree.persist", data: {} });
      result = { ...navigation, ...normalizeTree(await request("get_tree")) };
    } else if (options.operation.type === "edit") {
      const { entryId, text, expectedLeafId } = options.operation;
      const guardedLeafId = navigationLeaf(initialTree, expectedLeafId);
      const edit = parseEdit(await request("edit_assistant_message", {
        entryId,
        text,
        ...(guardedLeafId !== undefined ? { expectedLeafId: guardedLeafId } : {}),
      }));
      if (edit.outcome === "edited") await request("extension_request", { name: "omoui.tree.persist", data: {} });
      result = { ...normalizeTree(await request("get_tree")), edit };
    }
  } finally {
    await child.stop(options.stopTimeoutsMs ?? { afterStdinEnd: 2_000, afterSigterm: 3_000 });
  }
  const exit = await child.exited;
  // Classic RPC can remain alive after EOF. stop() may therefore need to terminate
  // a child whose final response already confirmed the append was completed.
  if (exit.code !== null && exit.code !== 0) throw new SessionTreeRpcError(`omo session tree exited (${exit.signal ?? exit.code})`, "close", "process_exit", exit);
  return result;
}
