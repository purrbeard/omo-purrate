/**
 * Contract between the Electron main process, the preload script, and the renderer.
 * The preload script exposes an object satisfying OmoBridgeApi as `window.omo`.
 */
import type { ProjectSetting } from "./project-settings";
import type {
  ClientMethod,
  ClientParams,
  ClientResult,
  RequestId,
  RpcNotification,
  RpcServerRequest,
  ThreadItem,
  TurnError,
  TurnStatus,
  TodoPhase,
  LiveTask,
} from "./protocol";
import type { AndroidStatus } from "./android";
import type { OpencodexAccounts } from "./opencodex";
import type { SessionWorktree, WorkspaceFile, WorkspaceFileMatch, WorkspaceDocument } from "./workspace";
import type { DeviceOverview } from "./device-overview";
import type { AppUpdateStatus } from "./app-update";
import type { ModelRoutingInput, ModelRoutingSettings } from "./model-routing";
import type { WorkbenchBridgeApi } from "./workbench";
import type { BrowserBridgeApi } from "./browser";
import type { ServersBridgeApi } from "./servers";

/** URL of the official omo installer script. */
export const OMO_INSTALL_SCRIPT_URL = "https://get.omo.dev/install.sh";

/** The official installer command shown on onboarding and in Settings; `install()` runs the same script from a file. */
export const OMO_INSTALL_COMMAND = `curl -fsSL ${OMO_INSTALL_SCRIPT_URL} | bash` as const;

export const OMO_WINDOWS_INSTALL_SCRIPT_URL = "https://get.omo.dev/install.ps1";
export const OMO_WINDOWS_INSTALL_COMMAND = `irm ${OMO_WINDOWS_INSTALL_SCRIPT_URL} | iex` as const;

export function getOmoInstallCommand(platform: string): typeof OMO_INSTALL_COMMAND | typeof OMO_WINDOWS_INSTALL_COMMAND {
  return platform === "win32" ? OMO_WINDOWS_INSTALL_COMMAND : OMO_INSTALL_COMMAND;
}

export type BridgeState = "locating" | "not-found" | "starting" | "connected" | "exited" | "restarting" | "stopped";

/** Where the omo binary was found, in lookup order. */
export type OmoSource = "override" | "install.json" | "local-bin" | "login-path";

export interface OmoBinary {
  path: string;
  version: string;
  source: OmoSource;
}

export type OmoUpdateStatus =
  | { state: "checking" | "installing" | "current" | "disabled" }
  | { state: "updated"; from: string; to: string }
  | { state: "failed"; message: string };

export interface BridgeStatus {
  state: BridgeState;
  omo: OmoBinary | null;
  /** userAgent from the initialize response while connected. */
  userAgent: string | null;
  /** Human-readable reason for the not-found, exited, and restarting states. */
  message: string | null;
  /** Last 4 KB of the omo child's stderr after an unexpected exit. */
  stderrTail: string | null;
  exitCode: number | null;
  /** Consecutive automatic restart attempts since the last successful connection. */
  restartAttempt: number;
  installCommand: typeof OMO_INSTALL_COMMAND | typeof OMO_WINDOWS_INSTALL_COMMAND;
  /** Result of this app launch's automatic update, independent of connection failures. */
  update?: OmoUpdateStatus;
  /** Whether the connected host is omo's shared host or a private one this app started. */
  transport?: "shared" | "private";
  /** Why the shared host was not used although the setting asked for it. */
  hostNotice?: string | null;
}

export interface Diagnostics {
  omo: OmoBinary | null;
  childPid: number | null;
  /** PATH value passed to the omo child. */
  childPath: string | null;
  /** True when the login-shell environment resolved; false when the fallback environment was used. */
  loginShellEnv: boolean;
  appVersion: string;
  electronVersion: string;
  platform: string;
  userDataPath: string;
}

export type ThemePreference = "system" | "light" | "dark";
export type PalettePreference = "noir" | "omo" | "classic" | "mint" | "ocean" | "sbd";
export type LocalePreference = "system" | "en" | "ko";


export type ModelProfile = "daily-normal" | "daily-heavy" | "geeky-normal" | "geeky-heavy";

/** When macOS notifications fire for threads other than the active one. */
export type ThreadNotificationPreference = "off" | "background" | "always";

/** How every clock time renders; "system" follows the OS clock preference. */
export type TimeFormatPreference = "system" | "12h" | "24h";
/** Which key sends the composer draft: Enter (Shift+Enter breaks the line) or Ctrl/Cmd+Enter (Enter breaks the line). */
export type SendKeyPreference = "enter" | "ctrlEnter";

export type ThreadOrigin = "user" | "agent" | "dori" | "unknown";

/** Creation evidence for a session offered for import: "app" and "terminal" were opened by a person. */
export type ImportEvidence = "app" | "alpha" | "terminal" | "automation" | "other-client" | "child" | "empty";
export type ImportLocation = "temp" | "quarantine" | "hidden";

export interface ImportCandidate {
  id: string;
  sessionPath: string;
  cwd: string;
  name: string | null;
  preview: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  sizeBytes: number;
  userMessages: number;
  evidence: ImportEvidence;
  defects: string[];
  /** Set when the session's folder is scratch space (temp, quarantine, a hidden folder in HOME). */
  location: ImportLocation | null;
  importable: boolean;
  /** Selected by default: importable, person-opened, and in an ordinary folder. */
  recommended: boolean;
}

export interface ImportPage {
  items: ImportCandidate[];
  nextCursor: string | null;
  /** Sessions with no user message; never listed. */
  emptyCount: number;
}

/** Creator evidence captured by this app's explicit new-session action. */
export interface ThreadCreatorEvidence {
  origin: "user";
  source: "ui-new-session";
}

export interface Preferences {
  /** Thread ids explicitly managed by this app. */
  managedThreadIds: string[];
  /** Sessions shown in the sidebar's pinned section. */
  pinnedThreadIds: string[];
  /** Explicit ownership for related sessions; session files and cwd stay unchanged. */
  threadParents: Record<string, string>;
  /** Manual creator overrides keyed by thread ID, separate from creation evidence. */
  threadOrigins?: Record<string, ThreadOrigin>;
  /** Structured creation evidence keyed by thread ID; omitted in older preferences. */
  threadCreators?: Record<string, ThreadCreatorEvidence>;
  /** Automatic native omo updates on app launch; omitted in older preferences means enabled. */
  omoAutoUpdate?: boolean;
  theme: ThemePreference;
  palette?: PalettePreference;
  locale: LocalePreference;
  /** Workspace directory used for the last new session. */
  lastWorkspace: string | null;
  /** Most recent workspace directories, newest first, at most 10 entries. */
  recentWorkspaces: string[];
  /** Model id chosen in the composer, or null for the omo default. */
  modelId: string | null;
  modelProfile?: ModelProfile | null;
  profileModels?: Partial<Record<ModelProfile, string>>;
  /** True once the first-run wizard finished or was dismissed; older preferences without the field infer it from workspace use. */
  onboardingCompleted: boolean;
  /** When macOS notifications fire for threads other than the active one. */
  threadNotifications: ThreadNotificationPreference;
  /** Whether a focused window also shows an in-app toast for other threads' outcomes. */
  inAppNotifications: boolean;
  /** How every clock time renders; "system" follows the OS clock preference. */
  timeFormat: TimeFormatPreference;
  /** The composer's send key. */
  sendKey: SendKeyPreference;
  /** Whether inactive sidebar threads settle automatically after `autoSettleDays`. */
  autoSettle: boolean;
  /** Whole days of inactivity before an idle thread auto-settles, clamped to 1..365. */
  autoSettleDays: number;
  /** Thread ids the user settled manually; any new activity un-settles the thread again. */
  settledThreads: string[];
  /** Thread ids the user unsettled manually, blocking auto-settle until their next activity. */
  unsettledThreads: string[];
  /** True once the first-run session import was confirmed or skipped. */
  sessionImportCompleted?: boolean;
  /** Attach to omo's shared host instead of starting a private one; omitted means off. */
  sharedHost?: boolean;
  /** ssh config aliases the Servers panel folds into its Hidden group. */
  hiddenSshHosts?: string[];
  /** What Enter does while a turn is running: steer the running turn, or queue the message for after it (Alt+Enter does the other). */
  followUpBehavior: FollowUpPreference;
  /** Open the workflow graph in the right dock when a new workflow run starts. */
  openWorkflowOnRun: boolean;
  /** Show the context usage gauge in the composer bar. */
  showContextUsage: boolean;
  /** Gradient keyword text and the spectrum frame for magic keywords; hints show either way. */
  keywordEffects: boolean;
  /** Interface zoom in percent, 80..150. */
  uiScale: number;
  /** Border and secondary-text contrast in percent, 80..150; 100 is the palette as designed. */
  contrast: number;
  /** Composer text size in px (12..20), or null for the theme size. */
  promptFontSize: number | null;
  /** Code block and diff text size in px (11..18), or null for the theme size. */
  codeFontSize: number | null;
  /** Terminal text size in px (10..24), or null for the theme size. */
  terminalFontSize: number | null;
  terminalCursorBlink: boolean;
  /** Colors for added/removed lines and counts. */
  diffColors: DiffColorPreference;
  /** Denser sidebar thread rows. */
  compactSidebar: boolean;
  /** Turn off interface animations and transitions, in addition to the OS reduced-motion setting. */
  reduceMotion: boolean;
  // Track B: projects
  /** Per-project display name, icon and color keyed by workspace directory; never renames the folder. */
  projectSettings: Record<string, ProjectSetting>;
}

export type FollowUpPreference = "steer" | "queue";
export type DiffColorPreference = "red-green" | "blue-orange";

/** Preferences every field resets to on "Restore device defaults" (Settings → General, top right). */
export const DEFAULT_PREFERENCES: Preferences = {
  managedThreadIds: [],
  pinnedThreadIds: [],
  threadParents: {},
  threadOrigins: {},
  threadCreators: {},
  omoAutoUpdate: true,
  theme: "system",
  locale: "system",
  palette: "noir",
  lastWorkspace: null,
  recentWorkspaces: [],
  modelId: null,
  onboardingCompleted: false,
  threadNotifications: "background",
  inAppNotifications: true,
  timeFormat: "system",
  sendKey: "enter",
  autoSettle: true,
  autoSettleDays: 3,
  settledThreads: [],
  unsettledThreads: [],
  followUpBehavior: "steer",
  openWorkflowOnRun: false,
  showContextUsage: true,
  keywordEffects: true,
  uiScale: 100,
  contrast: 100,
  promptFontSize: null,
  codeFontSize: null,
  terminalFontSize: null,
  terminalCursorBlink: true,
  diffColors: "red-green",
  compactSidebar: false,
  reduceMotion: false,
  // Track B: projects
  projectSettings: {},
};

/** One turn reconstructed from a session JSONL file. */
export interface HistoryTurn {
  id: string;
  status: TurnStatus;
  error: TurnError | null;
  items: ThreadItem[];
  /** Unix milliseconds. */
  startedAt: number | null;
  /** Unix milliseconds. */
  completedAt: number | null;
}

export interface HistoricalTask {
  /** Active-branch turn containing the structured spawn receipt, not a completion wake. */
  turn_id?: string;
  task_id: string;
  status: string;
  source: "history";
  mode?: string;
  task_summary?: string;
  name?: string;
  category?: string;
  agent_type?: string;
  execution_mode?: string;
  model?: string;
  final_response?: string;
  error_message?: string;
  final_response_truncated?: boolean;
  error_message_truncated?: boolean;
}

/** What omo recorded about one memory write on its memory tool result (`details.writeNotice`). */
export interface MemoryWriteNotice {
  sha: string;
  subject: string;
  affected: Array<{ path: string; insertions: number; deletions: number }>;
  /** Bytes injected into every system prompt, all memory bytes, and memory files. */
  size: { systemBytes: number; totalBytes: number; fileCount: number } | null;
  entriesToday: number | null;
  previousEntryAt: string | null;
  lastConsolidationAt: string | null;
}

/**
 * A session `custom_message` entry: context omo injected or showed outside the conversation items (memory notices,
 * recalled memories, monitor and task wake-ups, model profile changes). `turnIndex` and `afterItems` place it among
 * the parsed turns: after `afterItems` items of turn `turnIndex`. `display` is omo's own flag for user-facing ones.
 */
export interface SessionNotice {
  id: string;
  customType: string;
  display: boolean;
  text: string;
  timestamp: number | null;
  turnIndex: number;
  afterItems: number;
}

export interface HistoryResult {
  turns: HistoryTurn[];
  /** The last model and thinking level recorded on the active branch. */
  model?: { provider: string; modelId: string; thinkingLevel: string | null };
  todo: { phases: TodoPhase[] } | null;
  tasks: HistoricalTask[];
  /** Memory writes keyed by the memory tool call id. */
  memoryWrites?: Record<string, MemoryWriteNotice>;
  notices?: SessionNotice[];
}

/** Read-only child work from native task records and each child's active session branch. */
export interface TaskWork {
  parentSessionId: string;
  task: LiveTask;
  todo: HistoryResult["todo"];
  activity: string | null;
  history?: HistoryResult;
}

/** A watched task store changed: the parent's child work and persisted workflow runs as now on disk. */
export interface TaskStoreUpdate {
  parentSessionId: string;
  work: TaskWork[];
  runs: import("./protocol").DagRun[];
}

export interface InstallLogLine {
  stream: "stdout" | "stderr";
  text: string;
}

export interface InstallResult {
  ok: boolean;
  exitCode: number | null;
}

export interface ProxySettings {
  baseUrl: string;
  apiKeyConfigured: boolean;
  modelCount: number;
}

export interface ProxyInput {
  baseUrl: string;
  apiKey?: string;
}

/** Commands the application menu (electron/menu.ts) sends to the renderer; App.tsx routes each one. */
export type MenuCommand =
  | "new-session" | "settings" | "toggle-sidebar" | "command-palette" | "open-project"
  | "toggle-agents" | "toggle-workflow" | "toggle-files" | "toggle-terminal" | "toggle-side-chat" | "keyboard-shortcuts";

/** Where the header's Open button can open a thread's workspace; `finder` is always available. */
export const OPEN_TARGET_IDS = ["vscode", "cursor", "terminal", "finder"] as const;
export type OpenTargetId = (typeof OPEN_TARGET_IDS)[number];

/** Git facts of one directory; null when the directory is not inside a git work tree. */
export interface GitInfo {
  /** Branch name, or the short sha of a detached HEAD. */
  branch: string;
  /** Absolute path of the work-tree root from `git rev-parse --show-toplevel`. */
  root: string;
  /** Commits on HEAD missing from the upstream; null when the branch has no upstream. */
  ahead: number | null;
  /** Commits on the upstream missing from HEAD; null when the branch has no upstream. */
  behind: number | null;
  /** True for a linked worktree (`git worktree add`), whose git dir differs from the common dir. */
  worktree: boolean;
}

/** Outcome of `git add -A` + commit (+ optional push); git failures reject before this resolves. */
export interface GitCommitResult {
  /** False when git reported nothing to commit. */
  committed: boolean;
  pushed: boolean;
  /** "no-upstream" when a requested push was skipped because the branch has no upstream. */
  pushSkipped: "no-upstream" | null;
  /** Short sha of the created commit, when one was created. */
  commitHash: string | null;
}

/** Permission presets the composer's picker offers; the values are omo `permissionPreset` settings keys. */
export const PERMISSION_PRESETS = ["full-access", "workspace", "ask"] as const;
export type PermissionPreset = (typeof PERMISSION_PRESETS)[number];

export interface OpenTarget {
  id: OpenTargetId;
}

export interface IphoneStatus {
  enabled: boolean;
  state: "searching" | "connecting" | "connected";
  devices: { id: number; name: string; serial: string; state: "connecting" | "connected"; pendingApproval: boolean }[];
}

/** Identifies the user message a branch is cut at: its text and how many earlier user messages carry the same text. */
export interface BranchPoint {
  /** The message's text inputs joined with "\n", as the conversation item holds them. */
  text: string;
  /** 0 for the first user message with this text on the active branch, 1 for the second, and so on. */
  occurrence: number;
}

/** The session file a branch wrote; `threadId` is its session id. */
export interface BranchResult {
  threadId: string;
  path: string;
}

export type SessionTreeOperation =
  | { type: "list" }
  | { type: "navigate"; entryId: string; intent: "select" | "resume"; expectedLeafId?: string | null }
  | { type: "retry"; point: BranchPoint };

export interface SessionTreeResult {
  leafId: string | null;
  branches: Array<{ entryId: string; label: string; active: boolean }>;
  outcome?: "navigated" | "cancelled";
}

/** Subscription providers whose stored accounts report usage windows. */
export const USAGE_PROVIDERS = ["anthropic-subscription", "chatgpt-subscription"] as const;
export type UsageProvider = (typeof USAGE_PROVIDERS)[number];

/** One usage window, such as Claude's 5-hour window; `percent` is the share used, null when uncapped. */
export interface UsageWindow {
  label: string;
  percent: number | null;
  resetsAt: string | null;
  limited: boolean;
}

/**
 * Usage of one stored subscription account, read with its own token in the main process; no secret crosses IPC.
 * `state` is "expired" when the stored token is past its expiry (omo renews it the next time it uses the account).
 */
export interface AccountUsage {
  provider: UsageProvider;
  account: string;
  email: string | null;
  plan: string | null;
  windows: UsageWindow[];
  state: "ok" | "expired" | "failed";
  message: string | null;
}

/** Identifies the thread a notification or toast is about, so opening it stays one hop. */
export interface NotifyPayload {
  title: string;
  body: string;
  threadId: string;
}

/** `"[native]"` sections of `~/.omo/omo.jsonc` that map a research agent or a task category to models. */
export type ModelMappingKind = "agents" | "categories";

/** One rung of a fallback chain: a provider/model id and an optional reasoning level such as "high". */
export interface ModelRung {
  model: string;
  reasoning: string | null;
}

/** The overrides `~/.omo/omo.jsonc` holds; a name without an entry uses omo's built-in chain. */
export interface ModelMapping {
  path: string;
  agents: Record<string, ModelRung[]>;
  categories: Record<string, ModelRung[]>;
}

/** Built-in research agents and task categories omo 5.1 resolves models for. */
export const MODEL_MAPPING_NAMES: Readonly<Record<ModelMappingKind, readonly string[]>> = {
  agents: ["explore", "librarian", "plan-consultant", "plan-reviewer", "multimodal-looker", "omo-native-code-reviewer", "omo-native-gate-reviewer", "omo-native-qa-executor"],
  categories: ["quick", "unspecified-low", "unspecified-high", "deep-low", "deep-high", "ultrabrain", "architect", "visual-engineering", "artistry", "writing"],
};

export interface ThreadLink {
  parentId: string;
  childId?: string;
  taskId?: string;
  /** Native parentSession headers, distinct from user-created related-conversation links. */
  origin?: "native";
  title: string;
  status?: import("./protocol").LiveTask["status"];
}

export interface OmoBridgeApi extends WorkbenchBridgeApi, BrowserBridgeApi, ServersBridgeApi {
  /** Optional JSONL paths add verified header links and their parent chain, using header IDs. */
  loadThreadLinks(cwds: string[], paths?: string[]): Promise<ThreadLink[]>;
  /** Keys are the requested JSONL paths, not thread IDs; unknown creation origins are omitted. */
  loadThreadOrigins(paths: string[]): Promise<Record<string, "user" | "agent" | "dori">>;
  loadImportCandidates(cursor: string | null, limit?: number): Promise<ImportPage>;
  /** Adds the importable sessions among the given paths to the managed list; returns the ids added. */
  importSessions(sessionPaths: string[]): Promise<{ imported: string[] }>;
  /** Which of the given sessions another omo process holds open, and which have no session file on disk. */
  inspectSessions(threadIds: string[]): Promise<SessionInspection>;
  readModelRouting(): Promise<ModelRoutingSettings>;
  saveModelRouting(input: ModelRoutingInput): Promise<ModelRoutingSettings>;
  importExistingMcpConfigs(): Promise<{ imported: string[]; sources: number }>;
  readConfiguredMcpServers(): Promise<Array<{ name: string; enabled: boolean; type: string }>>;
  getAppUpdateStatus(): Promise<AppUpdateStatus>;
  checkAppUpdate(): Promise<AppUpdateStatus>;
  installAppUpdate(): Promise<AppUpdateStatus>;
  onAppUpdateStatus(listener: (status: AppUpdateStatus) => void): () => void;
  getDeviceOverview(): Promise<DeviceOverview>;
  listWorkspaceFiles(cwd: string): Promise<WorkspaceFile[]>;
  /** Files of the thread's workspace whose path contains `query` (the composer's @ mention); `cwd` must be the thread's own cwd. */
  searchWorkspaceFiles(threadId: string, cwd: string, query: string): Promise<WorkspaceFileMatch[]>;
  readWorkspaceFile(cwd: string, relativePath: string): Promise<WorkspaceDocument>;
  getWorkspaceDiff(cwd: string, relativePath: string): Promise<string>;
  /** Commits since `sinceMs` and other worktrees' uncommitted changes across the repository of `cwd`. */
  listSessionWork(cwd: string, sinceMs: number): Promise<SessionWorktree[]>;
  importMcpConfig(): Promise<{ imported: string[] } | null>;
  readOpencodexAccounts(): Promise<OpencodexAccounts>;
  getAndroidStatus(): Promise<AndroidStatus>;
  refreshAndroid(): Promise<AndroidStatus>;
  connectAndroid(serial: string): Promise<AndroidStatus>;
  disconnectAndroid(): Promise<AndroidStatus>;
  onAndroidStatus(listener: (status: AndroidStatus) => void): () => void;
  getProxySettings(): Promise<ProxySettings>;
  applyProxySettings(input: ProxyInput): Promise<ProxySettings>;
  /** Reads every stored subscription account's usage windows; one failing account never blanks the others. */
  readAccountUsage(): Promise<AccountUsage[]>;
  /** Opens omo in Terminal running its own sign-in command for `provider` ("/claude-account add", "/gpt-account add", else "/login"). */
  openAccountLogin(provider: string): Promise<void>;
  getIphoneStatus(): Promise<IphoneStatus>;
  onIphoneStatus(listener: (status: IphoneStatus) => void): () => void;
  getStatus(): Promise<BridgeStatus>;
  onStatus(listener: (status: BridgeStatus) => void): () => void;
  /** Sends one app-server request; rejects with Error("<code>: <message>") on an RPC error or when not connected. */
  request<M extends ClientMethod>(method: M, params: ClientParams<M>): Promise<ClientResult<M>>;
  onNotification(listener: (notification: RpcNotification) => void): () => void;
  onServerRequest(listener: (request: RpcServerRequest) => void): () => void;
  /** Answers a server request (approval or user input) with a JSON-RPC result carrying the same id. */
  respond(id: RequestId, result: unknown): Promise<void>;
  /** Re-locates omo and restarts the app-server child. */
  restart(): Promise<void>;
  /** Downloads and runs the official installer script in a login shell, streams output through onInstallLog, and restarts the bridge on success. */
  install(): Promise<InstallResult>;
  onInstallLog(listener: (line: InstallLogLine) => void): () => void;
  /** Writes the session at `threadId` as one HTML file: omo's `export_html`.
   * Returns the written path, or null when the user cancels the save dialog. */
  exportSession(threadId: string): Promise<{ path: string } | null>;
  /** Parses the session JSONL at sessionPath, which must resolve inside the omo sessions directory. */
  loadHistory(sessionPath: string): Promise<HistoryResult>;
  /** Follows one session file for writes by another omo process; null stops. Changes arrive through onHistoryChanged. */
  watchHistory(sessionPath: string | null): Promise<void>;
  onHistoryChanged(listener: (sessionPath: string) => void): () => void;
  /** Every saved preferences change, whichever caller made it. */
  onPreferencesChanged(listener: (preferences: Preferences) => void): () => void;
  /** Reads only tasks reachable through explicit child-session links in this workspace's native task store. */
  loadTaskWork(cwd: string, parentSessionId: string): Promise<TaskWork[]>;
  /**
   * Watches the parent's native task store (task records, workflow runs, child session files) for another omo process's
   * writes, pushing each change through onTaskWorkChanged; one push follows right away. Calls are counted per parent:
   * each watchTaskStore needs one unwatchTaskStore.
   */
  watchTaskStore(cwd: string, parentSessionId: string): Promise<void>;
  unwatchTaskStore(parentSessionId: string): Promise<void>;
  onTaskWorkChanged(listener: (update: TaskStoreUpdate) => void): () => void;
  sendTaskMessage(parentSessionId: string, taskId: string, message: string): Promise<void>;
  /**
   * Writes a new session beside `sessionPath` (which must resolve inside the omo sessions directory) holding that
   * session's active branch up to, but excluding, the user message at `point`; the source session is not modified.
   */
  branchSession(sessionPath: string, point: BranchPoint): Promise<BranchResult>;
  sessionTree(threadId: string, operation: SessionTreeOperation): Promise<SessionTreeResult>;
  /** Native folder picker; resolves null on cancel. The OMO_UI_QA_PICK_DIR variable short-circuits the dialog. */
  pickDirectory(defaultPath?: string | null): Promise<string | null>;
  /** Native picker for any files (multiple) or one folder; resolves an empty array on cancel. */
  pickAttachments(kind: "files" | "folder"): Promise<string[]>;
  imageFilePath(file: File): string;
  /** Writes a PNG/JPEG/GIF/WebP data URL under userData/attachments and resolves its absolute path. */
  saveImage(dataUrl: string): Promise<string>;
  getDiagnostics(): Promise<Diagnostics>;
  getPreferences(): Promise<Preferences>;
  setPreferences(patch: Partial<Preferences>): Promise<Preferences>;
  /** Sets the main window zoom factor (0.8..1.5). */
  setZoomFactor(factor: number): Promise<void>;
  /** Shows a macOS notification for a thread outcome; a click focuses the window and opens the thread. */
  notify(payload: NotifyPayload): Promise<void>;
  /** The thread the user clicked in a macOS notification. */
  onNotifyClick(listener: (threadId: string) => void): () => void;
  onMenuCommand(listener: (command: MenuCommand) => void): () => void;
  copyText(text: string): Promise<void>;
  /** Reads clipboard text only when explicitly invoked by the renderer. */
  readClipboardText(): Promise<string>;
  openExternal(url: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  /** Opens the app's log directory (main.log) in the system file manager. */
  openLogsFolder(): Promise<void>;
  /** Installed Open targets in preference order (editors, Terminal, then Finder). */
  listOpenTargets(): Promise<OpenTarget[]>;
  /** Opens `cwd` (an absolute, existing directory) in `target`; with no target, the first installed editor, else Finder. Resolves the target used. */
  openWorkspace(cwd: string, target?: OpenTargetId | null): Promise<OpenTargetId>;
  /** Branch, root, and upstream ahead/behind of `cwd`; null when it is not inside a git work tree. */
  gitInfo(cwd: string): Promise<GitInfo | null>;
  /** Verbatim `git status --porcelain` lines of `cwd`; empty when the work tree is clean. */
  gitStatus(cwd: string): Promise<string[]>;
  /** Stages all changes, commits `message`, and pushes when `push` is true; a push without an upstream is skipped and reported. */
  gitCommitPush(cwd: string, message: string, push: boolean): Promise<GitCommitResult>;
  /** The workspace's omo `permissionPreset`; "full-access" when unset. */
  getPermissionPreset(cwd: string): Promise<PermissionPreset>;
  /** Merges the preset into `<cwd>/.omo/settings.json` before the next turn; see docs/permissions.md. */
  setPermissionPreset(cwd: string, preset: PermissionPreset): Promise<void>;
  readonly platform: string;
}

/** IPC channel names. Invoke channels use ipcRenderer.invoke; event channels use webContents.send. */
export const IPC = {
  loadThreadLinks: "history:thread-links",
  loadThreadOrigins: "history:thread-origins",
  loadImportCandidates: "history:import-candidates",
  importSessions: "history:import-sessions",
  inspectSessions: "history:inspect-sessions",
  readModelRouting: "models:read-routing",
  saveModelRouting: "models:save-routing",
  importExistingMcpConfigs: "mcp:import-existing",
  readConfiguredMcpServers: "mcp:configured",
  getAppUpdateStatus: "app-update:get-status",
  checkAppUpdate: "app-update:check",
  installAppUpdate: "app-update:install",
  appUpdateStatus: "app-update:status",
  getDeviceOverview: "devices:overview",
  listWorkspaceFiles: "workspace:list-files",
  searchWorkspaceFiles: "workspace:search-files",
  readWorkspaceFile: "workspace:read-file",
  getWorkspaceDiff: "workspace:diff",
  listSessionWork: "workspace:session-work",
  importMcpConfig: "mcp:import-config",
  readOpencodexAccounts: "accounts:opencodex",
  getAndroidStatus: "android:get-status",
  refreshAndroid: "android:refresh",
  connectAndroid: "android:connect",
  disconnectAndroid: "android:disconnect",
  androidStatus: "android:status",
  getProxySettings: "proxy:get-settings",
  applyProxySettings: "proxy:apply-settings",
  getIphoneStatus: "iphone:get-status",
  iphoneStatus: "iphone:status",
  getStatus: "omo:get-status",
  status: "omo:status",
  request: "omo:request",
  notification: "omo:notification",
  serverRequest: "omo:server-request",
  respond: "omo:respond",
  restart: "omo:restart",
  install: "omo:install",
  installLog: "omo:install-log",
  loadHistory: "history:load",
  exportSession: "session:export",
  watchHistory: "history:watch",
  historyChanged: "history:changed",
  preferencesChanged: "prefs:changed",
  loadTaskWork: "history:task-work",
  watchTaskStore: "history:task-store-watch",
  unwatchTaskStore: "history:task-store-unwatch",
  taskWorkChanged: "history:task-work-changed",
  sendTaskMessage: "history:task-message",
  branchSession: "history:branch",
  sessionTree: "history:tree",
  readAccountUsage: "accounts:usage",
  openAccountLogin: "accounts:login",
  pickDirectory: "dialog:pick-directory",
  pickAttachments: "dialog:pick-attachments",
  saveImage: "attachments:save-image",
  diagnostics: "app:diagnostics",
  getPreferences: "prefs:get",
  setPreferences: "prefs:set",
  setZoomFactor: "ui:set-zoom",
  notify: "app:notify",
  notifyClick: "app:notify-click",
  menuCommand: "menu:command",
  copyText: "app:copy-text",
  readClipboardText: "app:read-clipboard-text",
  openExternal: "app:open-external",
  revealPath: "app:reveal-path",
  openLogsFolder: "app:open-logs-folder",
  listOpenTargets: "app:list-open-targets",
  openWorkspace: "app:open-workspace",
  gitInfo: "git:info",
  gitStatus: "git:status",
  gitCommitPush: "git:commit-push",
  getPermissionPreset: "workspace:preset:get",
  setPermissionPreset: "workspace:preset:set",
} as const;

/** What `inspectSessions` found: live foreign holders by session id (unheld sessions are absent) and ids without a session file. */
export interface SessionInspection {
  holders: Record<string, import("./session-held").SessionHolder[]>;
  missing: string[];
}

/** Result envelope the main process returns from the `omo:request` invoke channel. */
export type RequestEnvelope<R = unknown> =
  | { ok: true; result: R }
  | { ok: false; error: { code: number; message: string } };

export const ENV = {
  /** Absolute path of the omo binary; when set, no other location is tried. */
  omoBin: "OMO_UI_OMO_BIN",
  /** Directory returned by pickDirectory without opening the native dialog (tests and QA). */
  qaPickDir: "OMO_UI_QA_PICK_DIR",
  /** JSON array of absolute attachment paths returned without a native dialog; must match the requested kind. */
  qaPickAttachments: "OMO_UI_QA_PICK_ATTACHMENTS",
  /** Overrides Electron's userData directory (tests and QA). */
  userData: "OMO_UI_USER_DATA",
  /** The path a save dialog returns instead of prompting (tests and QA). */
  qaSavePath: "OMO_UI_QA_SAVE_PATH",
  /** Appends one JSON line per macOS thread notification to this file (tests and QA); the notification still shows. */
  qaNotifyLog: "OMO_UI_QA_NOTIFY_LOG",
  /** Renderer dev-server URL loaded instead of dist/index.html. */
  devUrl: "OMO_UI_DEV_URL",
  /** "0" skips the launch-time omo update regardless of the preference (tests and QA). */
  omoAutoUpdate: "OMO_UI_OMO_AUTO_UPDATE",
  /** omo's agent directory (sessions, goal stores) when it is not `<home>/.omo/agent` (tests and QA). */
  qaAgentDir: "OMO_UI_QA_AGENT_DIR",
  /** OmO (Alpha)'s data home whose `userdata/omo-sessions` store is listed beside omo's sessions; "" turns it off (tests and QA). */
  alphaHome: "OMO_UI_ALPHA_HOME",
  /** The ssh client config the Servers panel reads instead of `~/.ssh/config` (tests and QA). */
  sshConfig: "OMO_UI_SSH_CONFIG",
  /** The ssh binary the Servers panel runs instead of `ssh` on PATH; a `.mjs` runs under Electron's Node (tests and QA). */
  sshBin: "OMO_UI_SSH_BIN",
} as const;

declare global {
  interface Window {
    omo: OmoBridgeApi;
  }
}
