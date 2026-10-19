import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { IpcRendererEvent } from "electron";
import type {
  IphoneStatus,
  BranchPoint,
  AccountUsage,
  ModelMapping,
  ModelMappingKind,
  ModelRung,
  BranchResult,
  SessionTreeOperation,
  SessionTreeResult,
  BridgeStatus,
  Diagnostics,
  GitCommitResult,
  GitInfo,
  HistoryResult,
  ImportPage,
  PermissionPreset,
  TaskWork,
  InstallLogLine,
  InstallResult,
  IPC,
  MenuCommand,
  NotifyPayload,
  OmoBridgeApi,
  OpenTarget,
  OpenTargetId,
  Preferences,
  ProxyInput,
  ProxySettings,
  RequestEnvelope,
} from "../shared/ipc";
import type { ClientMethod, ClientParams, ClientResult, RequestId, RpcNotification, RpcServerRequest } from "../shared/protocol";
import { stripRemoteMethodPrefix } from "./ipc-errors";
import type { AndroidStatus } from "../shared/android";
import type { OpencodexAccounts } from "../shared/opencodex";
import type { SessionWorktree, WorkspaceFile, WorkspaceDocument } from "../shared/workspace";
import type { DeviceOverview } from "../shared/device-overview";
import type { AppUpdateStatus } from "../shared/app-update";
import type { ModelRoutingInput, ModelRoutingSettings } from "../shared/model-routing";
import type { ContextUsage, NativeCatalog, TerminalChunk, TerminalExit, TerminalSnapshot, WORKBENCH_IPC } from "../shared/workbench";
import type { DagRun } from "../shared/protocol";
import type { SERVERS_IPC, SshHostState, SshInventory } from "../shared/servers";
import type { BROWSER_IPC, BrowserColorScheme, BrowserDevice, BrowserRect, BrowserScreenshot, BrowserState, BrowserZoom, LocalServer, PickedElement } from "../shared/browser";

// The sandboxed preload can require only "electron", so the channel table is restated here; `satisfies` keeps it equal to IPC.
const CHANNELS = {
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
  watchHistory: "history:watch",
  historyChanged: "history:changed",
  loadTaskWork: "history:task-work",
  sendTaskMessage: "history:task-message",
  loadThreadLinks: "history:thread-links",
  loadThreadOrigins: "history:thread-origins",
  loadImportCandidates: "history:import-candidates",
  importSessions: "history:import-sessions",
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
} as const satisfies typeof IPC;

const WORKBENCH = {
  loadContextUsage: "workbench:context-usage",
  loadNativeCatalog: "workbench:native-catalog",
  loadDagRuns: "workbench:dag-runs",
  terminalOpen: "terminal:open",
  terminalWrite: "terminal:write",
  terminalResize: "terminal:resize",
  terminalKill: "terminal:kill",
  terminalChunk: "terminal:chunk",
  terminalExit: "terminal:exit",
} as const satisfies typeof WORKBENCH_IPC;

const BROWSER = {
  show: "browser:show",
  hide: "browser:hide",
  snapshot: "browser:snapshot",
  navigate: "browser:navigate",
  back: "browser:back",
  forward: "browser:forward",
  reload: "browser:reload",
  devtools: "browser:devtools",
  colorScheme: "browser:color-scheme",
  zoom: "browser:zoom",
  device: "browser:device",
  clearCookies: "browser:clear-cookies",
  clearCache: "browser:clear-cache",
  screenshot: "browser:screenshot",
  copyImage: "browser:copy-image",
  pick: "browser:pick",
  cancelPick: "browser:cancel-pick",
  localServers: "browser:local-servers",
  state: "browser:state",
} as const satisfies typeof BROWSER_IPC;

const SERVERS = {
  list: "servers:list",
  test: "servers:test",
  refresh: "servers:refresh",
  state: "servers:state",
} as const satisfies typeof SERVERS_IPC;

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    const result: T = await ipcRenderer.invoke(channel, ...args);
    return result;
  } catch (error) {
    throw new Error(stripRemoteMethodPrefix(error instanceof Error ? error.message : String(error)));
  }
}

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api = {
  loadContextUsage: (sessionPath: string): Promise<ContextUsage> => invoke(WORKBENCH.loadContextUsage, sessionPath),
  loadNativeCatalog: (cwd: string, force?: boolean): Promise<NativeCatalog> => invoke(WORKBENCH.loadNativeCatalog, cwd, force === true),
  loadDagRuns: (cwd: string, threadId: string): Promise<DagRun[]> => invoke(WORKBENCH.loadDagRuns, cwd, threadId),
  terminalOpen: (threadId: string, cwd: string): Promise<TerminalSnapshot> => invoke(WORKBENCH.terminalOpen, threadId, cwd),
  terminalWrite: (threadId: string, data: string): Promise<void> => invoke(WORKBENCH.terminalWrite, threadId, data),
  terminalResize: (threadId: string, cols: number, rows: number): Promise<void> => invoke(WORKBENCH.terminalResize, threadId, cols, rows),
  terminalKill: (threadId: string): Promise<void> => invoke(WORKBENCH.terminalKill, threadId),
  onTerminalChunk: (listener: (chunk: TerminalChunk) => void) => subscribe(WORKBENCH.terminalChunk, listener),
  onTerminalExit: (listener: (exit: TerminalExit) => void) => subscribe(WORKBENCH.terminalExit, listener),
  browserShow: (rect: BrowserRect): Promise<BrowserState> => invoke(BROWSER.show, rect),
  browserHide: (): Promise<void> => invoke(BROWSER.hide),
  browserSnapshot: (): Promise<string | null> => invoke(BROWSER.snapshot),
  browserNavigate: (url: string): Promise<number> => invoke(BROWSER.navigate, url),
  browserBack: (): Promise<void> => invoke(BROWSER.back),
  browserForward: (): Promise<void> => invoke(BROWSER.forward),
  browserReload: (hard: boolean): Promise<void> => invoke(BROWSER.reload, hard),
  browserOpenDevTools: (): Promise<void> => invoke(BROWSER.devtools),
  browserSetColorScheme: (scheme: BrowserColorScheme): Promise<void> => invoke(BROWSER.colorScheme, scheme),
  browserZoom: (direction: BrowserZoom): Promise<number> => invoke(BROWSER.zoom, direction),
  browserSetDevice: (device: BrowserDevice): Promise<void> => invoke(BROWSER.device, device),
  browserClearCookies: (): Promise<void> => invoke(BROWSER.clearCookies),
  browserClearCache: (): Promise<void> => invoke(BROWSER.clearCache),
  browserScreenshot: (): Promise<BrowserScreenshot> => invoke(BROWSER.screenshot),
  browserCopyImage: (path: string): Promise<void> => invoke(BROWSER.copyImage, path),
  browserPickElement: (): Promise<PickedElement | null> => invoke(BROWSER.pick),
  browserCancelPick: (): Promise<void> => invoke(BROWSER.cancelPick),
  listLocalServers: (): Promise<LocalServer[]> => invoke(BROWSER.localServers),
  onBrowserState: (listener: (state: BrowserState) => void) => subscribe(BROWSER.state, listener),
  listSshHosts: (): Promise<SshInventory> => invoke(SERVERS.list),
  testSshHost: (alias: string): Promise<SshHostState> => invoke(SERVERS.test, alias),
  refreshSshSpecs: (alias: string): Promise<SshHostState> => invoke(SERVERS.refresh, alias),
  onSshHostState: (listener: (state: SshHostState) => void) => subscribe(SERVERS.state, listener),
  readModelRouting: (): Promise<ModelRoutingSettings> => invoke(CHANNELS.readModelRouting),
  saveModelRouting: (input: ModelRoutingInput): Promise<ModelRoutingSettings> => invoke(CHANNELS.saveModelRouting, input),
  importExistingMcpConfigs: (): Promise<{ imported: string[]; sources: number }> => invoke(CHANNELS.importExistingMcpConfigs),
  readConfiguredMcpServers: (): Promise<Array<{ name: string; enabled: boolean; type: string }>> => invoke(CHANNELS.readConfiguredMcpServers),
  getAppUpdateStatus: (): Promise<AppUpdateStatus> => invoke(CHANNELS.getAppUpdateStatus),
  checkAppUpdate: (): Promise<AppUpdateStatus> => invoke(CHANNELS.checkAppUpdate),
  installAppUpdate: (): Promise<AppUpdateStatus> => invoke(CHANNELS.installAppUpdate),
  onAppUpdateStatus: (listener: (status: AppUpdateStatus) => void) => subscribe(CHANNELS.appUpdateStatus, listener),
  getDeviceOverview: (): Promise<DeviceOverview> => invoke(CHANNELS.getDeviceOverview),
  listWorkspaceFiles: (cwd: string): Promise<WorkspaceFile[]> => invoke(CHANNELS.listWorkspaceFiles, cwd),
  readWorkspaceFile: (cwd: string, relativePath: string): Promise<WorkspaceDocument> => invoke(CHANNELS.readWorkspaceFile, cwd, relativePath),
  getWorkspaceDiff: (cwd: string, relativePath: string): Promise<string> => invoke(CHANNELS.getWorkspaceDiff, cwd, relativePath),
  listSessionWork: (cwd: string, sinceMs: number): Promise<SessionWorktree[]> => invoke(CHANNELS.listSessionWork, cwd, sinceMs),
  importMcpConfig: (): Promise<{ imported: string[] } | null> => invoke(CHANNELS.importMcpConfig),
  readOpencodexAccounts: (): Promise<OpencodexAccounts> => invoke(CHANNELS.readOpencodexAccounts),
  getAndroidStatus: (): Promise<AndroidStatus> => invoke(CHANNELS.getAndroidStatus),
  refreshAndroid: (): Promise<AndroidStatus> => invoke(CHANNELS.refreshAndroid),
  connectAndroid: (serial: string): Promise<AndroidStatus> => invoke(CHANNELS.connectAndroid, serial),
  disconnectAndroid: (): Promise<AndroidStatus> => invoke(CHANNELS.disconnectAndroid),
  onAndroidStatus: (listener: (status: AndroidStatus) => void) => subscribe(CHANNELS.androidStatus, listener),
  getProxySettings: (): Promise<ProxySettings> => invoke(CHANNELS.getProxySettings),
  applyProxySettings: (input: ProxyInput): Promise<ProxySettings> => invoke(CHANNELS.applyProxySettings, input),
  getIphoneStatus: (): Promise<IphoneStatus> => invoke(CHANNELS.getIphoneStatus),
  onIphoneStatus: (listener: (status: IphoneStatus) => void) => subscribe(CHANNELS.iphoneStatus, listener),
  getStatus: (): Promise<BridgeStatus> => invoke(CHANNELS.getStatus),
  onStatus: (listener: (status: BridgeStatus) => void) => subscribe(CHANNELS.status, listener),
  async request<M extends ClientMethod>(method: M, params: ClientParams<M>): Promise<ClientResult<M>> {
    const envelope: RequestEnvelope<ClientResult<M>> = await invoke(CHANNELS.request, method, params);
    if (!envelope.ok) throw new Error(`${envelope.error.code}: ${envelope.error.message}`);
    return envelope.result;
  },
  onNotification: (listener: (notification: RpcNotification) => void) => subscribe(CHANNELS.notification, listener),
  onServerRequest: (listener: (request: RpcServerRequest) => void) => subscribe(CHANNELS.serverRequest, listener),
  respond: (id: RequestId, result: unknown): Promise<void> => invoke(CHANNELS.respond, id, result),
  restart: (): Promise<void> => invoke(CHANNELS.restart),
  install: (): Promise<InstallResult> => invoke(CHANNELS.install),
  onInstallLog: (listener: (line: InstallLogLine) => void) => subscribe(CHANNELS.installLog, listener),
  loadHistory: (sessionPath: string): Promise<HistoryResult> => invoke(CHANNELS.loadHistory, sessionPath),
  watchHistory: (sessionPath: string | null): Promise<void> => invoke(CHANNELS.watchHistory, sessionPath),
  onHistoryChanged: (listener: (sessionPath: string) => void) => subscribe(CHANNELS.historyChanged, listener),
  loadTaskWork: (cwd: string, parentSessionId: string): Promise<TaskWork[]> => invoke(CHANNELS.loadTaskWork, cwd, parentSessionId),
  sendTaskMessage: (parentSessionId: string, taskId: string, message: string): Promise<void> => invoke(CHANNELS.sendTaskMessage, parentSessionId, taskId, message),
  loadThreadLinks: (cwds: string[], paths?: string[]) => invoke(CHANNELS.loadThreadLinks, cwds, paths),
  loadThreadOrigins: (paths: string[]): Promise<Record<string, "user" | "agent" | "dori">> => invoke(CHANNELS.loadThreadOrigins, paths),
  loadImportCandidates: (cursor: string | null, limit?: number): Promise<ImportPage> => invoke(CHANNELS.loadImportCandidates, cursor, limit),
  importSessions: (sessionPaths: string[]): Promise<{ imported: string[] }> => invoke(CHANNELS.importSessions, sessionPaths),
  branchSession: (sessionPath: string, point: BranchPoint): Promise<BranchResult> => invoke(CHANNELS.branchSession, sessionPath, point),
  sessionTree: (threadId: string, operation: SessionTreeOperation): Promise<SessionTreeResult> => invoke(CHANNELS.sessionTree, threadId, operation),
  readAccountUsage: (): Promise<AccountUsage[]> => invoke(CHANNELS.readAccountUsage),
  openAccountLogin: (provider: string): Promise<void> => invoke(CHANNELS.openAccountLogin, provider),
  pickDirectory: (defaultPath?: string | null): Promise<string | null> =>
    invoke(CHANNELS.pickDirectory, defaultPath ?? null),
  pickAttachments: (kind: "files" | "folder"): Promise<string[]> => invoke(CHANNELS.pickAttachments, kind),
  imageFilePath: (file: File): string => webUtils.getPathForFile(file),
  saveImage: (dataUrl: string): Promise<string> => invoke(CHANNELS.saveImage, dataUrl),
  getDiagnostics: (): Promise<Diagnostics> => invoke(CHANNELS.diagnostics),
  getPreferences: (): Promise<Preferences> => invoke(CHANNELS.getPreferences),
  setPreferences: (patch: Partial<Preferences>): Promise<Preferences> => invoke(CHANNELS.setPreferences, patch),
  notify: (payload: NotifyPayload): Promise<void> => invoke(CHANNELS.notify, payload),
  onNotifyClick: (listener: (threadId: string) => void) => subscribe(CHANNELS.notifyClick, listener),
  onMenuCommand: (listener: (command: MenuCommand) => void) => subscribe(CHANNELS.menuCommand, listener),
  copyText: (text: string): Promise<void> => invoke(CHANNELS.copyText, text),
  readClipboardText: (): Promise<string> => invoke(CHANNELS.readClipboardText),
  openExternal: (url: string): Promise<void> => invoke(CHANNELS.openExternal, url),
  revealPath: (target: string): Promise<void> => invoke(CHANNELS.revealPath, target),
  openLogsFolder: (): Promise<void> => invoke(CHANNELS.openLogsFolder),
  listOpenTargets: (): Promise<OpenTarget[]> => invoke(CHANNELS.listOpenTargets),
  openWorkspace: (cwd: string, target?: OpenTargetId | null): Promise<OpenTargetId> =>
    invoke(CHANNELS.openWorkspace, cwd, target ?? null),
  gitInfo: (cwd: string): Promise<GitInfo | null> => invoke(CHANNELS.gitInfo, cwd),
  gitStatus: (cwd: string): Promise<string[]> => invoke(CHANNELS.gitStatus, cwd),
  gitCommitPush: (cwd: string, message: string, push: boolean): Promise<GitCommitResult> =>
    invoke(CHANNELS.gitCommitPush, cwd, message, push),
  getPermissionPreset: (cwd: string): Promise<PermissionPreset> => invoke(CHANNELS.getPermissionPreset, cwd),
  setPermissionPreset: (cwd: string, preset: PermissionPreset): Promise<void> => invoke(CHANNELS.setPermissionPreset, cwd, preset),
  platform: process.platform,
} satisfies OmoBridgeApi;

contextBridge.exposeInMainWorld("omo", api);
