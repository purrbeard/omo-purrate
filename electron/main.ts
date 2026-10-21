import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, shell } from "electron";
import { ENV, IPC } from "../shared/ipc";
import type { MenuCommand } from "../shared/ipc";
import { createAttentionTracker } from "./attention";
import { IphoneBridge, loadIphoneToken } from "./iphone/bridge";
import { AndroidBridge } from "./android/bridge";
import { createSessionFileResolver, registerIpc } from "./ipc";
import { registerWorkbenchIpc } from "./workbench-ipc";
import { BrowserHost } from "./browser/browser-host";
import { registerBrowserIpc } from "./browser/ipc";
import { registerServersIpc } from "./servers/ipc";
import { createSshRunner } from "./servers/probe";
import { ServersHost } from "./servers/servers-host";
import { sshConfigPath } from "./servers/ssh-config";
import { SERVERS_IPC } from "../shared/servers";
import { createWorkbenchHandlers } from "./workbench/create-handlers";
import { initLogging } from "./logging";
import { installApplicationMenu } from "./menu";
import { OmoSupervisor } from "./omo/supervisor";
import { registerMediaProtocol, registerMediaScheme } from "./media-protocol";
import { PreferencesStore } from "./prefs";

const QUIT_STOP_TIMEOUT_MS = 5_000;

/** The install identity (folder, exe, userData) keeps the original product name; only the shown name changed. */
const INSTALL_NAME = "OmO UI Windows";
app.setName("omo Purrate");
app.setPath("userData", process.env[ENV.userData] || path.join(app.getPath("appData"), INSTALL_NAME));

// Track C: the media scheme must be registered before the app is ready.
registerMediaScheme();

const devUrl = process.env[ENV.devUrl] || null;
/**
 * Test runs open a window the user can neither see, click nor focus (transparent, click-through, never activated), at its
 * normal place so its display scale stays the real one; Chromium must not then treat it as occluded and stop painting.
 */
const background = process.env[ENV.backgroundWindow] === "1";
if (background) app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
const indexPath = path.join(__dirname, "../dist/index.html");
let mainWindow: BrowserWindow | null = null;
const attention = createAttentionTracker({ window: () => mainWindow });

function isAppUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    void error;
    return false;
  }
  if (devUrl) return parsed.origin === new URL(devUrl).origin;
  return parsed.protocol === "file:" && fileURLToPath(parsed) === indexPath;
}

function openIfWeb(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 520,
    minHeight: 600,
    title: "omo Purrate",
    show: false,
    ...(background ? { opacity: 0, focusable: false, skipTaskbar: true } : {}),
    ...(process.platform === "darwin" ? {
      titleBarStyle: "hiddenInset" as const,
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: "sidebar" as const,
      visualEffectState: "active" as const,
      backgroundColor: "#00000000",
    } : {
      backgroundColor: "#171717",
      icon: app.isPackaged ? path.join(process.resourcesPath, "icon.png") : path.join(__dirname, "../build/icon.png"),
    }),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      ...(background ? { backgroundThrottling: false } : {}),
    },
  });
  if (background) window.setIgnoreMouseEvents(true);
  window.once("ready-to-show", () => (background ? window.showInactive() : window.show()));
  window.on("focus", attention.onFocus);
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openIfWeb(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openIfWeb(url);
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(indexPath);
  mainWindow = window;
  return window;
}

function focusWindow(): void {
  const window = mainWindow ?? createWindow();
  if (window.isMinimized()) window.restore();
  if (background) { window.showInactive(); return; }
  window.show();
  window.focus();
}

function sendMenuCommand(command: MenuCommand): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  mainWindow.webContents.send(IPC.menuCommand, command);
}

function run(): void {
  const logger = initLogging(app.getPath("logs"));
  logger.log("info", "app started", { version: app.getVersion(), platform: process.platform });
  process.on("uncaughtException", (error) => {
    logger.log("error", "uncaught exception", error);
    console.error(error);
    app.exit(1);
  });
  process.on("unhandledRejection", (reason: unknown) => {
    logger.log("error", "unhandled rejection", reason);
    console.error(reason);
  });
  // Unpackaged runs (dev, e2e) get their own id: Windows notifications make Electron create a Start-menu shortcut to
  // node_modules' electron.exe under this id, and a shortcut sharing the installed app's id puts Electron's icon on its
  // taskbar button.
  if (process.platform === "win32") app.setAppUserModelId(app.isPackaged ? "io.github.purrbeard.omopurrate" : "io.github.purrbeard.omopurrate.dev");
  const homeDir = os.homedir();
  const prefs = new PreferencesStore(app.getPath("userData"));
  const supervisor = new OmoSupervisor({
    homeDir, baseEnv: process.env, clientVersion: app.getVersion(), stateDir: app.getPath("userData"),
    extensionPath: path.join(app.isPackaged ? process.resourcesPath : __dirname, "task-message-extension.js"),
    autoUpdate: { enabled: () => process.env[ENV.omoAutoUpdate] !== "0" && prefs.get().omoAutoUpdate !== false },
    sharedHost: () => prefs.get().sharedHost === true,
  });
  const unsubscribeNotification = supervisor.onNotification(attention.onNotification);
  const unsubscribeServerRequest = supervisor.onServerRequest(attention.onServerRequest);
  let previousState = supervisor.getStatus().state;
  const unsubscribeStatus = supervisor.onStatus((status) => {
    if (status.state === previousState) return;
    previousState = status.state;
    if (status.state === "exited" || status.state === "restarting" || status.state === "stopped") {
      logger.log(status.state === "exited" ? "error" : "info", `app-server ${status.state}`, {
        message: status.message, exitCode: status.exitCode, restartAttempt: status.restartAttempt,
      });
    }
  });

  const iphone = new IphoneBridge(supervisor, undefined, undefined, loadIphoneToken(app.getPath("userData")));
  const android = new AndroidBridge(supervisor);
  const workbench = createWorkbenchHandlers({ supervisor, homeDir, getWindow: () => mainWindow, sessionFile: createSessionFileResolver(supervisor, homeDir) });
  const browser = new BrowserHost({
    getWindow: () => mainWindow,
    screenshotsDir: () => path.join(app.getPath("userData"), "screenshots"),
    downloadsDir: () => app.getPath("downloads"),
  });
  const servers = new ServersHost({
    configPath: sshConfigPath(process.env, homeDir),
    cacheFile: path.join(app.getPath("userData"), "ssh-hosts.json"),
    run: createSshRunner(process.env[ENV.sshBin] || "ssh", process.env),
    send: (state) => mainWindow?.webContents.send(SERVERS_IPC.state, state),
  });

  app.on("second-instance", () => {
    if (app.isReady()) focusWindow();
  });

  void app.whenReady().then(() => {
    if (!app.isPackaged) app.dock?.setIcon(path.join(__dirname, "../build/icon.png"));
    installApplicationMenu(sendMenuCommand, { openLogs: () => void shell.openPath(logger.dir) });
    registerMediaProtocol();
    registerIpc({ supervisor, iphone, android, prefs, getWindow: () => mainWindow, homeDir });
    registerWorkbenchIpc(workbench);
    registerBrowserIpc(browser);
    registerServersIpc(servers);
    createWindow();
    iphone.start();
    void supervisor.start();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  let quitPhase: "running" | "stopping" | "done" = "running";
  app.on("before-quit", (event) => {
    if (quitPhase === "done") return;
    event.preventDefault();
    if (quitPhase === "stopping") return;
    quitPhase = "stopping";
    unsubscribeNotification();
    unsubscribeServerRequest();
    attention.dispose();
    iphone.stop();
    browser.dispose();
    let timer: NodeJS.Timeout | undefined;
    const bounded = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.error(`omo did not stop within ${QUIT_STOP_TIMEOUT_MS} ms; quitting anyway`);
        resolve();
      }, QUIT_STOP_TIMEOUT_MS);
    });
    const stopped = Promise.all([android.stop(), supervisor.stop(), workbench.dispose()]).catch((error: unknown) => {
      console.error("failed to stop omo", error);
    });
    void Promise.race([stopped, bounded]).finally(() => {
      clearTimeout(timer);
      unsubscribeStatus();
      quitPhase = "done";
      // With no omo child, stop() settles inside Electron's native before-quit dispatch (Cmd+Q, the Dock's Quit,
      // SIGTERM); an app.quit() made there is discarded with the prevented quit, so quit again from a new task.
      setImmediate(() => app.quit());
    });
  });
}

if (app.requestSingleInstanceLock()) run();
else app.quit();
