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
  kind: "approval" | "confirm" | "question" | "dialog";
  uiId: string;
  session: UiSession;
  questions?: UserInputQuestion[];
  toolCallId?: string;
}

/** Extension event names the renderer reads for omo's fire-and-forget UI methods. */
export const UI_NOTIFY_EVENT = "omo-ui:notify";
export const UI_STATUS_EVENT = "omo-ui:status";
export const UI_EDITOR_TEXT_EVENT = "omo-ui:editor-text";
const DIALOG_QUESTION_ID = "value";
const NOTIFY_TYPES = new Set(["info", "warning", "error"]);

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
  private readonly statuses = new Map<string, { threadId: string; entries: Map<string, string> }>();

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
    switch (record["method"]) {
      case "notify": {
        const message = readString(record, "message");
        const type = readString(record, "notifyType");
        if (message !== undefined && message.trim() !== "") {
          this.event(session.threadId, UI_NOTIFY_EVENT, { id: readString(record, "id") ?? `n${this.nextId++}`, message, notifyType: type !== undefined && NOTIFY_TYPES.has(type) ? type : "info" });
        }
        return;
      }
      case "setStatus":
        this.setStatus(session, record);
        return;
      case "set_editor_text": {
        const text = readString(record, "text");
        if (text !== undefined) this.event(session.threadId, UI_EDITOR_TEXT_EVENT, { text });
        return;
      }
      default:
        break;
    }
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
        if (reason === undefined) this.dialog(session, uiId, record, "input");
        else this.answer(session.handle, { id: uiId, value: reason });
        return;
      }
      case "editor":
        this.dialog(session, uiId, record, "editor");
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
    const status = this.statuses.get(handle);
    if (status !== undefined) {
      this.statuses.delete(handle);
      this.event(status.threadId, UI_STATUS_EVENT, { entries: {} });
    }
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
    } else if (pending.kind === "dialog") {
      this.answer(handle, this.dialogAnswer(pending.uiId, pending.questions ?? [], value));
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
      this.dialog(session, uiId, record, "select");
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

  private event(threadId: string, name: string, data: JsonObject): void {
    this.notify({ method: "extension_event", params: { type: "extension_event", threadId, name, data } });
  }

  private setStatus(session: UiSession, record: JsonObject): void {
    const key = readString(record, "statusKey");
    if (key === undefined) return;
    const text = readString(record, "statusText");
    const status = this.statuses.get(session.handle) ?? { threadId: session.threadId, entries: new Map<string, string>() };
    if (text === undefined || text.trim() === "") status.entries.delete(key);
    else status.entries.set(key, text);
    this.statuses.set(session.handle, status);
    this.event(session.threadId, UI_STATUS_EVENT, { entries: Object.fromEntries(status.entries) });
  }

  /** A select / input / editor dialog the app has no special case for, asked as one requestUserInput question. */
  private dialog(session: UiSession, uiId: string, record: JsonObject, kind: "select" | "input" | "editor"): void {
    const title = readString(record, "title") ?? "";
    const options = kind === "select" && Array.isArray(record["options"])
      ? record["options"].filter((option): option is string => typeof option === "string").map((label) => ({ label, description: "" }))
      : [];
    const prefill = kind === "editor" ? readString(record, "prefill") ?? "" : "";
    const questions: UserInputQuestion[] = [{
      id: DIALOG_QUESTION_ID, header: "", question: prefill === "" ? title : `${title}\n\n${prefill}`,
      isOther: kind !== "select", isSecret: false, options: options.length > 0 ? options : null, multiSelect: false,
    }];
    const timeout = typeof record["timeout"] === "number" ? record["timeout"] : null;
    this.serverRequest(session, { kind: "dialog", uiId, session, questions }, "item/tool/requestUserInput", {
      itemId: readString(record, "toolCallId") ?? uiId, questions, waitForAnswer: true, timeoutMs: timeout, autoResolutionMs: null,
    }, "user-input");
  }

  private dialogAnswer(uiId: string, questions: UserInputQuestion[], value: JsonObject): JsonObject {
    const answered = this.questionAnswer(uiId, questions, value);
    const answers = answered["answers"];
    const entry = isRecord(answers) ? answers[DIALOG_QUESTION_ID] : undefined;
    if (!isRecord(entry)) return { id: uiId, cancelled: true };
    const selected = Array.isArray(entry["selected"]) ? entry["selected"].filter((text): text is string => typeof text === "string") : [];
    const text = typeof entry["text"] === "string" ? entry["text"] : undefined;
    return { id: uiId, value: selected[0] ?? text ?? "" };
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
