import type { ApprovalDecision, RequestId, RpcNotification, RpcServerRequest, UserInputQuestion } from "../../../shared/protocol";

type JsonObject = Record<string, unknown>;

const PERMISSION_PREFIX = "Permission required: ";
const ALLOW_ONCE = "Allow once";
const ALLOW_ALWAYS = "Allow always";
const DENY = "Deny";
const DENY_WITH_FEEDBACK = "Deny with feedback";
const REPLACE_GOAL_PREFIX = "Replace goal?";
const REPLACE_GOAL_CHOICE = "Replace current goal";
const APPROVAL_DECISIONS: ApprovalDecision[] = ["accept", "acceptForSession", "decline", "cancel"];
const FILE_TOOLS = new Set(["edit", "write", "apply_patch", "multiedit"]);

export interface UiSession {
  threadId: string;
  handle: string;
  cwd: string;
  activeTurnId: string | null;
  /** The files a running file tool call is about to change, by tool call id. */
  filePaths?: (toolCallId: string | undefined) => string[];
}

interface Pending {
  kind: "approval" | "confirm" | "question";
  uiId: string;
  session: UiSession;
  questions?: UserInputQuestion[];
  toolCallId?: string;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: JsonObject, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function lineValue(text: string, prefix: string): string | undefined {
  return text.split("\n").find((line) => line.startsWith(prefix))?.slice(prefix.length);
}

/**
 * Turns omo's extension UI dialogs into the app-server server requests the renderer already answers:
 * permission prompts become command / file-change approvals, `question` becomes requestUserInput.
 * Dialogs the app has no surface for are cancelled, as the removed app-server did.
 */
export class UiBridge {
  private nextId = 0;
  private readonly pending = new Map<RequestId, Pending>();
  private readonly feedback = new Map<string, string>();
  private readonly goalReplace = new Set<string>();

  constructor(
    private readonly answer: (handle: string, frame: JsonObject) => void,
    private readonly request: (request: RpcServerRequest) => void,
    private readonly notify: (notification: RpcNotification) => void,
  ) {}

  expectGoalReplace(handle: string): void {
    this.goalReplace.add(handle);
  }

  clearGoalReplace(handle: string): void {
    this.goalReplace.delete(handle);
  }

  handle(session: UiSession, record: JsonObject): void {
    const uiId = readString(record, "id");
    if (uiId === undefined) return;
    switch (record["method"]) {
      case "select":
        this.select(session, uiId, record);
        return;
      case "confirm":
        this.serverRequest(session, { kind: "confirm", uiId, session }, "item/commandExecution/requestApproval", {
          itemId: "approval-confirm", command: readString(record, "title") ?? null, reason: readString(record, "message") ?? null,
          cwd: session.cwd, availableDecisions: APPROVAL_DECISIONS,
        });
        return;
      case "input": {
        const key = `${session.handle}\u0000${readString(record, "toolCallId") ?? ""}`;
        const reason = this.feedback.get(key) ?? this.feedback.get(`${session.handle}\u0000`);
        this.feedback.delete(key);
        this.feedback.delete(`${session.handle}\u0000`);
        this.answer(session.handle, reason === undefined ? { id: uiId, cancelled: true } : { id: uiId, value: reason });
        return;
      }
      case "editor":
        this.answer(session.handle, { id: uiId, value: readString(record, "prefill") ?? "" });
        return;
      case "question":
        this.question(session, uiId, record);
        return;
      default:
        return;
    }
  }

  resolved(record: JsonObject): void {
    const uiId = readString(record, "id");
    for (const [id, pending] of this.pending) {
      if (pending.uiId !== uiId) continue;
      this.pending.delete(id);
      this.notify({ method: "serverRequest/resolved", params: { threadId: pending.session.threadId, requestId: id } });
    }
  }

  dropSession(handle: string): void {
    this.goalReplace.delete(handle);
    for (const [id, pending] of this.pending) {
      if (pending.session.handle !== handle) continue;
      this.pending.delete(id);
      this.notify({ method: "serverRequest/resolved", params: { threadId: pending.session.threadId, requestId: id } });
    }
  }

  /** Answers a server request the renderer replied to; false when the id is not one of ours. */
  respond(id: RequestId, result: unknown): boolean {
    const pending = this.pending.get(id);
    if (pending === undefined) return false;
    this.pending.delete(id);
    const value = isRecord(result) ? result : {};
    const { handle } = pending.session;
    if (pending.kind === "question") {
      this.answer(handle, this.questionAnswer(pending.uiId, pending.questions ?? [], value));
    } else {
      const decision = APPROVAL_DECISIONS.find((entry) => entry === value["decision"]) ?? "cancel";
      const reason = typeof value["reason"] === "string" && value["reason"].trim() !== "" ? value["reason"] : undefined;
      if (pending.kind === "confirm") {
        this.answer(handle, { id: pending.uiId, confirmed: decision === "accept" || decision === "acceptForSession" });
      } else if (decision === "accept") {
        this.answer(handle, { id: pending.uiId, value: ALLOW_ONCE });
      } else if (decision === "acceptForSession") {
        this.answer(handle, { id: pending.uiId, value: ALLOW_ALWAYS });
      } else if (reason !== undefined) {
        this.feedback.set(`${handle}\u0000${pending.toolCallId ?? ""}`, reason);
        this.answer(handle, { id: pending.uiId, value: DENY_WITH_FEEDBACK });
      } else {
        this.answer(handle, { id: pending.uiId, value: DENY });
      }
    }
    this.notify({ method: "serverRequest/resolved", params: { threadId: pending.session.threadId, requestId: id } });
    return true;
  }

  private select(session: UiSession, uiId: string, record: JsonObject): void {
    const title = readString(record, "title") ?? "";
    const options = Array.isArray(record["options"]) ? record["options"].filter((option): option is string => typeof option === "string") : [];
    if (title.startsWith(REPLACE_GOAL_PREFIX) && this.goalReplace.has(session.handle) && options.includes(REPLACE_GOAL_CHOICE)) {
      this.goalReplace.delete(session.handle);
      this.answer(session.handle, { id: uiId, value: REPLACE_GOAL_CHOICE });
      return;
    }
    const [firstLine = "", ...rest] = title.split("\n");
    if (!firstLine.startsWith(PERMISSION_PREFIX) || !options.includes(ALLOW_ONCE) || !options.includes(DENY)) {
      this.answer(session.handle, { id: uiId, cancelled: true });
      return;
    }
    const toolName = firstLine.slice(PERMISSION_PREFIX.length).trim();
    const reason = rest.join("\n").trim();
    const toolCallId = readString(record, "toolCallId");
    const fileChange = FILE_TOOLS.has(toolName);
    const subject = lineValue(reason, "Command: $ ") ?? lineValue(reason, "File: ") ?? lineValue(reason, "Path: ") ?? null;
    const itemId = toolCallId ?? `approval-${toolName}`;
    const pending: Pending = { kind: "approval", uiId, session, ...(toolCallId === undefined ? {} : { toolCallId }) };
    if (fileChange) {
      const paths = [...new Set([...(session.filePaths?.(toolCallId) ?? []), ...(subject === null ? [] : [subject])])];
      this.serverRequest(session, pending, "item/fileChange/requestApproval", { itemId, reason: reason || null, grantRoot: null, ...(paths.length === 0 ? {} : { paths }) });
    } else {
      this.serverRequest(session, pending, "item/commandExecution/requestApproval", {
        itemId, command: subject, cwd: session.cwd, reason: reason || null, availableDecisions: APPROVAL_DECISIONS,
      });
    }
  }

  private question(session: UiSession, uiId: string, record: JsonObject): void {
    const raw = Array.isArray(record["questions"]) ? record["questions"].filter(isRecord) : [];
    const questions: UserInputQuestion[] = raw.flatMap((question) => {
      const id = readString(question, "id");
      if (id === undefined) return [];
      const options = Array.isArray(question["options"])
        ? question["options"].filter(isRecord).flatMap((option) => typeof option["label"] === "string"
          ? [{ label: option["label"], description: readString(option, "description") ?? "" }] : [])
        : [];
      return [{
        id, header: readString(question, "header") ?? "", question: readString(question, "question") ?? "",
        isOther: true, isSecret: false, options: options.length > 0 ? options : null, multiSelect: question["multiSelect"] === true,
      }];
    });
    const timeout = typeof record["timeout"] === "number" ? record["timeout"] : null;
    this.serverRequest(session, { kind: "question", uiId, session, questions }, "item/tool/requestUserInput", {
      itemId: readString(record, "toolCallId") ?? readString(record, "requestId") ?? uiId,
      questions, waitForAnswer: record["waitForAnswer"] !== false, timeoutMs: timeout, autoResolutionMs: null,
    }, "user-input");
  }

  private questionAnswer(uiId: string, questions: UserInputQuestion[], value: JsonObject): JsonObject {
    if (value["cancelled"] === true) return { id: uiId, cancelled: true };
    const answers: Record<string, { selected: string[]; text?: string }> = {};
    const given = isRecord(value["answers"]) ? value["answers"] : {};
    for (const question of questions) {
      const entry = given[question.id];
      const values = isRecord(entry) && Array.isArray(entry["answers"]) ? entry["answers"].filter((text): text is string => typeof text === "string") : [];
      if (values.length === 0) continue;
      const labels = new Set((question.options ?? []).map((option) => option.label));
      const text = values.filter((text) => !labels.has(text)).join("\n");
      answers[question.id] = { selected: values.filter((text) => labels.has(text)), ...(text === "" ? {} : { text }) };
    }
    const comment = typeof value["comment"] === "string" ? value["comment"] : undefined;
    if (Object.keys(answers).length === 0 && (comment === undefined || comment.trim() === "")) return { id: uiId, cancelled: true };
    return { id: uiId, answers, ...(comment === undefined ? {} : { comment }) };
  }

  private serverRequest(session: UiSession, pending: Pending, method: string, fields: JsonObject, prefix = "approval"): void {
    const id = `${prefix}-${this.nextId++}`;
    this.pending.set(id, pending);
    this.request({
      id,
      method,
      params: { threadId: session.threadId, turnId: session.activeTurnId ?? "turn-approval", startedAtMs: Date.now(), ...fields },
    });
  }
}
