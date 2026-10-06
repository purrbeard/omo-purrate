/**
 * Wire types for the subset of the omo app-server protocol (Codex app-server v2 as
 * pinned by senpi) that OmO UI uses. Frames are JSON objects without a `jsonrpc`
 * field, one object per LF-terminated line on stdio.
 */

export type RequestId = number | string;

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** A request in either direction: client-to-server calls and server-to-client approvals or questions. */
export interface RpcRequest<P = unknown> {
  id: RequestId;
  method: string;
  params?: P;
}

export interface RpcSuccess<R = unknown> {
  id: RequestId;
  result: R;
}

export interface RpcFailure {
  id: RequestId;
  error: RpcError;
}

export interface RpcNotification<P = unknown> {
  method: string;
  params?: P;
  emittedAtMs?: number;
}

/** A request the server sends to the client; the client answers with RpcSuccess carrying the same id. */
export type RpcServerRequest<P = unknown> = RpcRequest<P>;

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags: string[] };

export type TurnStatus = "inProgress" | "completed" | "interrupted" | "failed";

export interface TurnError {
  message: string;
  codexErrorInfo?: unknown;
  additionalDetails?: string | null;
}

export type UserInput =
  | { type: "text"; text: string; text_elements?: unknown[] }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

export type DynamicToolCallContentItem =
  | { type: "inputText"; text: string }
  | { type: "inputImage"; imageUrl: string };

export type ToolCallStatus = "inProgress" | "completed" | "failed";

export interface UserMessageItem {
  type: "userMessage";
  id: string;
  clientId?: string | null;
  content: UserInput[];
}

export interface AgentMessageItem {
  type: "agentMessage";
  id: string;
  text: string;
  phase?: string | null;
}

export interface ReasoningItem {
  type: "reasoning";
  id: string;
  summary: string[];
  content: string[];
}

export interface PlanItem {
  type: "plan";
  id: string;
  text: string;
}

export interface CommandExecutionItem {
  type: "commandExecution";
  id: string;
  command: string;
  cwd: string;
  status: "inProgress" | "completed" | "failed" | "declined";
  aggregatedOutput: string | null;
  exitCode: number | null;
  durationMs: number | null;
}

export interface FileUpdateChange {
  path: string;
  kind: unknown;
  diff: string;
}

export interface FileChangeItem {
  type: "fileChange";
  id: string;
  changes: FileUpdateChange[];
  status: "inProgress" | "completed" | "failed" | "declined";
}

export interface McpToolCallItem {
  type: "mcpToolCall";
  id: string;
  server: string;
  tool: string;
  status: ToolCallStatus;
  arguments: unknown;
  result: unknown;
  error: { message: string } | null;
  durationMs: number | null;
}

/** omo tools (eval, edit, task, todo, ...) arrive as dynamic tool calls. */
export interface DynamicToolCallItem {
  type: "dynamicToolCall";
  id: string;
  namespace: string | null;
  tool: string;
  arguments: unknown;
  status: ToolCallStatus;
  contentItems: DynamicToolCallContentItem[] | null;
  success: boolean | null;
  durationMs: number | null;
}

export interface WebSearchItem {
  type: "webSearch";
  id: string;
  query: string;
}

export interface ContextCompactionItem {
  type: "contextCompaction";
  id: string;
}

export type ThreadItem =
  | UserMessageItem
  | AgentMessageItem
  | ReasoningItem
  | PlanItem
  | CommandExecutionItem
  | FileChangeItem
  | McpToolCallItem
  | DynamicToolCallItem
  | WebSearchItem
  | ContextCompactionItem;

export type ThreadItemType = ThreadItem["type"];

export const KNOWN_ITEM_TYPES: ReadonlySet<string> = new Set<ThreadItemType>([
  "userMessage",
  "agentMessage",
  "reasoning",
  "plan",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
  "contextCompaction",
]);

/** Narrows a wire item to the known union; unknown item types from newer servers return false. */
export function isKnownItem(item: { type: string }): item is ThreadItem {
  return KNOWN_ITEM_TYPES.has(item.type);
}

export interface Turn {
  id: string;
  items: ThreadItem[];
  itemsView?: "full" | "summary" | "notLoaded";
  status: TurnStatus;
  error: TurnError | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
}

/** Timestamps (createdAt, updatedAt, recencyAt) are Unix seconds with a fractional part. */
export interface Thread {
  id: string;
  sessionId?: string;
  forkedFromId?: string | null;
  preview: string;
  ephemeral?: boolean;
  modelProvider?: string;
  createdAt: number;
  updatedAt: number;
  recencyAt?: number;
  status: ThreadStatus;
  /** Absolute path of the session JSONL file. */
  path: string | null;
  cwd: string;
  cliVersion?: string;
  source?: string;
  name: string | null;
  turns: Turn[];
}

export interface Model {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: Array<{ reasoningEffort: ReasoningEffort; description: string }>;
  defaultReasoningEffort: ReasoningEffort | null;
  isDefault: boolean;
}

export interface ThreadSessionResult {
  thread: Thread;
  model: string;
  modelProvider: string;
  cwd: string;
  reasoningEffort: ReasoningEffort | null;
}

export type SkillScope = "user" | "repo" | "system" | "admin";

export interface SkillInterface {
  displayName?: string;
  shortDescription?: string;
  iconSmall?: string;
  iconLarge?: string;
  brandColor?: string;
  defaultPrompt?: string;
}

export interface SkillToolDependency {
  type: string;
  value: string;
  description?: string;
  transport?: string;
  command?: string;
  url?: string;
}

export interface SkillDependencies {
  tools: SkillToolDependency[];
}

export interface SkillMetadata {
  name: string;
  description: string;
  shortDescription?: string;
  interface?: SkillInterface;
  dependencies?: SkillDependencies;
  path: string;
  scope: SkillScope;
  /** False means human-only invocation, not that the skill is unselectable. */
  enabled: boolean;
}

export interface SkillErrorInfo {
  path: string;
  message: string;
}

export interface SkillsListParams {
  cwds?: string[];
  forceReload?: boolean;
}

export interface SkillsListEntry {
  cwd: string;
  skills: SkillMetadata[];
  errors: SkillErrorInfo[];
}

export interface SkillsListResponse {
  data: SkillsListEntry[];
}

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
}

export interface McpServerStatus {
  name: string;
  serverInfo: { name: string; title?: string; version: string; description?: string; icons?: unknown[]; websiteUrl?: string } | null;
  tools: Record<string, McpTool>;
  resources: unknown[];
  resourceTemplates: unknown[];
  authStatus: string;
  status?: string;
}

/** A secret-free descriptor of one stored provider account; `name` is the immutable id, `displayName` a label. */
export interface ProviderAccount {
  name: string;
  source: string;
  blocked: boolean;
  pinned: boolean;
  displayName?: string;
}

export interface ClientRequestMap {
  "account/providerAccounts/read": { params: { provider: string }; result: { provider: string; accounts: ProviderAccount[] } };
  /** `name: null` clears the pin. */
  "account/providerAccounts/pin": { params: { provider: string; name: string | null }; result: unknown };
  "account/providerAccounts/remove": { params: { provider: string; name: string }; result: unknown };
  "mcpServerStatus/list": {
    params: { threadId?: string; detail?: string; cursor?: string | null; limit?: number };
    result: { data: McpServerStatus[]; nextCursor: string | null };
  };
  "thread/goal/get": { params: { threadId: string }; result: { goal: WireGoal | null } };
  extension_request: { params: { threadId: string; name: string; data?: unknown }; result: unknown };
  initialize: {
    params: {
      clientInfo: { name: string; title: string; version: string };
      capabilities: { experimentalApi: boolean };
    };
    /** codexHome and the platform fields are optional for older servers; isInitializeResult checks the types at runtime. */
    result: { userAgent: string; codexHome?: string; platformFamily?: string; platformOs?: string };
  };
  "model/list": {
    params: { includeHidden?: boolean; cursor?: number | null; limit?: number | null };
    result: { data: Model[]; nextCursor: number | null };
  };
  "skills/list": { params: SkillsListParams; result: SkillsListResponse };
  "thread/list": {
    params: {
      limit?: number | null;
      cursor?: string | null;
      cwd?: string | string[] | null;
      archived?: boolean | null;
      searchTerm?: string | null;
    };
    result: { data: Thread[]; nextCursor: string | null };
  };
  "thread/start": { params: { cwd: string; model?: string | null }; result: ThreadSessionResult };
  "thread/resume": { params: { threadId: string }; result: ThreadSessionResult };
  "thread/read": { params: { threadId: string; includeTurns?: boolean }; result: { thread: Thread } };
  "thread/name/set": { params: { threadId: string; name: string }; result: Record<string, never> };
  "thread/archive": { params: { threadId: string }; result: Record<string, never> };
  "thread/delete": { params: { threadId: string }; result: Record<string, never> };
  "turn/start": {
    params: {
      threadId: string;
      input: UserInput[];
      clientUserMessageId?: string | null;
      model?: string | null;
      effort?: ReasoningEffort | null;
    };
    result: { turn: Turn };
  };
  "turn/steer": { params: { threadId: string; expectedTurnId: string; input: UserInput[] }; result: unknown };
  "turn/interrupt": { params: { threadId: string; turnId: string }; result: Record<string, never> };
}

export type ClientMethod = keyof ClientRequestMap;
export type ClientParams<M extends ClientMethod> = ClientRequestMap[M]["params"];
export type ClientResult<M extends ClientMethod> = ClientRequestMap[M]["result"];

/** Methods the renderer may call through the bridge; the main process rejects anything else. */
export const CLIENT_METHODS = [
  "account/providerAccounts/read",
  "account/providerAccounts/pin",
  "account/providerAccounts/remove",
  "mcpServerStatus/list",
  "thread/goal/get",
  "extension_request",
  "initialize",
  "model/list",
  "skills/list",
  "thread/list",
  "thread/start",
  "thread/resume",
  "thread/read",
  "thread/name/set",
  "thread/archive",
  "thread/delete",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
] as const satisfies readonly ClientMethod[];

export interface ServerNotificationMap {
  "mcpServer/startupStatus/updated": unknown;
  "thread/goal/updated": { threadId: string; turnId: string | null; goal: WireGoal };
  "thread/goal/cleared": { threadId: string };
  "skills/changed": Record<string, never>;
  "thread/started": { thread: Thread };
  "thread/status/changed": { threadId: string; status: ThreadStatus };
  "thread/name/updated": { threadId: string; threadName?: string };
  "thread/archived": { threadId: string };
  "thread/deleted": { threadId: string };
  "turn/started": { threadId: string; turn: Turn };
  "turn/completed": { threadId: string; turn: Turn };
  "item/started": { threadId: string; turnId: string; item: ThreadItem; startedAtMs?: number };
  "item/completed": { threadId: string; turnId: string; item: ThreadItem; completedAtMs?: number };
  "item/agentMessage/delta": { threadId: string; turnId: string; itemId: string; delta: string };
  "item/reasoning/textDelta": { threadId: string; turnId: string; itemId: string; delta: string; contentIndex: number };
  "item/reasoning/summaryTextDelta": {
    threadId: string;
    turnId: string;
    itemId: string;
    delta: string;
    summaryIndex: number;
  };
  "item/commandExecution/outputDelta": { threadId: string; turnId: string; itemId: string; delta: string };
  error: { error: TurnError; willRetry: boolean; threadId: string; turnId: string };
  "serverRequest/resolved": { threadId: string; requestId: RequestId };
  extension_event: { type: "extension_event"; threadId: string; name: string; data: unknown };
}

export interface WireGoal {
  threadId: string;
  objective: string;
  status: "active" | "paused" | "blocked" | "complete";
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export interface DagNode {
  id: string;
  label?: string;
  prompt: string;
  depends_on: string[];
  state: string;
  attempt: number;
  created_at: string;
  task_id?: string;
  started_at?: string;
  completed_at?: string;
  last_error?: { code: string; message: string };
}

export interface DagRun {
  run_id: string;
  run_key: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  counts: Record<string, number>;
  nodes: DagNode[];
  edges: { from: string; to: string }[];
  waves: { index: number; node_ids: string[] }[];
  amend_count?: number;
  lease_holder_pid?: number;
}

export interface DagUpdated {
  parent_session_id: string;
  runs: DagRun[];
  truncated_runs?: number;
}

export interface DagActivity {
  schemaVersion: 1;
  runId: string;
  nodeId: string;
  taskId: string;
  at: string;
  activity: string;
  currentTool?: string;
  lastAssistantLine?: string;
  turns: number;
  toolCalls?: number;
}

export interface DagHeartbeat {
  schemaVersion: 1;
  at: string;
  runs: { runId: string; headSeq: number }[];
}

export interface TaskRunStats {
  runtime_ms: number;
  turns: number;
  tool_calls: number;
  output_tokens?: number;
  input_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  total_tokens?: number;
  generation_ms?: number;
  tokens_per_second?: number;
  cost_usd?: number;
  cache_hit_rate_last?: number;
  cache_hit_rate_run?: number;
  token_status?: "complete" | "partial" | "unavailable";
  cost_status?: "reported" | "unavailable" | "invalid";
  duration_status?: "monotonic" | "wall_clock" | "unavailable";
}

export interface LiveTask {
  task_id: string;
  status: string;
  execution_mode: string;
  model: string;
  residency_state: string;
  depth: number;
  created_at: string;
  updated_at: string;
  name?: string;
  task_summary?: string;
  description?: string;
  category?: string;
  agent_type?: string;
  child_session_id?: string;
  run_stats?: TaskRunStats;
  final_response?: string;
  error_message?: string;
  description_truncated?: true;
  final_response_truncated?: true;
  error_message_truncated?: true;
  failure_kind?: unknown;
  failure_reason?: unknown;
  live_progress?: {
    activity: string;
    started_at: number;
    current_tool?: string;
    last_assistant_line?: string;
    turns: number;
    tool_calls?: number;
    total_tokens?: number;
    output_tokens?: number;
    tokens_per_second?: number;
  };
}

export interface TasksUpdated {
  parent_session_id: string;
  tasks: LiveTask[];
  truncated_tasks?: number;
}

export interface TodoPhase {
  name: string;
  tasks: { content: string; status: "pending" | "in_progress" | "completed" | "abandoned" }[];
}

export type ServerNotificationMethod = keyof ServerNotificationMap;

export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export interface CommandApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs?: number;
  reason?: string | null;
  command?: string | null;
  cwd?: string | null;
  availableDecisions?: ApprovalDecision[];
}

export interface FileChangeApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs?: number;
  reason?: string | null;
  grantRoot?: string | null;
}

export interface UserInputOption {
  label: string;
  description: string;
}

export interface UserInputQuestion {
  id: string;
  header: string;
  question: string;
  isOther?: boolean;
  isSecret?: boolean;
  options: UserInputOption[] | null;
  multiSelect?: boolean;
}

export interface UserInputParams {
  threadId: string;
  turnId: string;
  itemId: string;
  questions: UserInputQuestion[];
  waitForAnswer?: boolean;
  timeoutMs?: number | null;
  autoResolutionMs?: number | null;
}

/**
 * Server-to-client requests. Approval answers carry `decision` (and an optional deny `reason`).
 * User-input answers map each question id to `{ answers }`, where an entry equal to an option
 * label selects that option and any other entry is free text.
 */
export interface ServerRequestMap {
  "item/commandExecution/requestApproval": {
    params: CommandApprovalParams;
    result: { decision: ApprovalDecision; reason?: string };
  };
  "item/fileChange/requestApproval": {
    params: FileChangeApprovalParams;
    result: { decision: ApprovalDecision; reason?: string };
  };
  "item/tool/requestUserInput": {
    params: UserInputParams;
    result: { answers: Record<string, { answers: string[] }>; comment?: string };
  };
}

export type ServerRequestMethod = keyof ServerRequestMap;
