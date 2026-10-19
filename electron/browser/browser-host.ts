import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { clipboard, ClipboardItem, session, WebContentsView } from "electron";
import type { BrowserWindow, Session } from "electron";
import { BROWSER_DEVICE_WIDTHS, BROWSER_IPC } from "../../shared/browser";
import type { BrowserColorScheme, BrowserDevice, BrowserRect, BrowserScreenshot, BrowserState, BrowserZoom, PickedElement } from "../../shared/browser";
import { CANCEL_PICK_SCRIPT, PICK_RESULT_SCRIPT, PICK_SCRIPT } from "./pick-element";

export const BROWSER_PARTITION = "persist:omo-ui-browser";
const PICK_WORLD = 1201;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
/** Chromium reports an aborted load (a navigation replaced by another) as -3; that is not a failure. */
const ERR_ABORTED = -3;
/** Permissions the page may use without a prompt; everything else (camera, location, notifications...) is denied. */
const ALLOWED_PERMISSIONS = new Set(["clipboard-sanitized-write", "fullscreen", "pointerLock"]);

export interface BrowserHostDeps {
  getWindow(): BrowserWindow | null;
  screenshotsDir(): string;
  downloadsDir(): string;
}

/** http(s) and about:blank are the only page URLs; anything else is refused at the IPC boundary. */
export function pageUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192) throw new Error("Browser URL must be a string");
  if (value === "about:blank") return value;
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`Invalid browser URL: ${value}`); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`Unsupported browser URL scheme: ${parsed.protocol}`);
  return parsed.toString();
}

export function browserRect(value: unknown): BrowserRect {
  if (typeof value !== "object" || value === null) throw new Error("Browser rect must be an object");
  const { x, y, width, height } = value as Record<string, unknown>;
  const finite = [x, y, width, height].every((entry) => typeof entry === "number" && Number.isFinite(entry) && Math.abs(entry) < 100_000);
  if (!finite || (width as number) < 0 || (height as number) < 0) throw new Error("Browser rect must hold finite x, y, width and height");
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

export function nextZoom(current: number, direction: BrowserZoom): number {
  if (direction === "reset") return 1;
  if (direction === "in") return ZOOM_STEPS.find((step) => step > current + 0.001) ?? ZOOM_STEPS.at(-1)!;
  return [...ZOOM_STEPS].reverse().find((step) => step < current - 0.001) ?? ZOOM_STEPS[0]!;
}

/** A file name in `dir` that does not exist yet: `name`, `name (1)`, `name (2)`, ... */
export function uniqueFile(dir: string, name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, "_") || "download";
  const ext = path.extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  for (let index = 0; ; index++) {
    const candidate = path.join(dir, index === 0 ? safe : `${stem} (${index})${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
}

/**
 * The browser dock's page: one WebContentsView over the panel's content rect in a separate persistent session,
 * sandboxed without Node, with window.open folded into the same view and downloads saved to the Downloads folder.
 */
export class BrowserHost {
  private view: WebContentsView | null = null;
  private window: BrowserWindow | null = null;
  private rect: BrowserRect | null = null;
  private shown = false;
  private device: BrowserDevice = "desktop";
  private colorScheme: BrowserColorScheme = "system";
  private error: BrowserState["error"] = null;
  private sessionReady = false;
  private navigation = 0;
  private picking = false;

  constructor(private readonly deps: BrowserHostDeps) {}

  state(): BrowserState {
    const contents = this.view?.webContents;
    const history = contents?.navigationHistory;
    return {
      url: contents === undefined ? "" : contents.getURL(),
      title: contents === undefined ? "" : contents.getTitle(),
      loading: contents?.isLoading() ?? false,
      canGoBack: history?.canGoBack() ?? false,
      canGoForward: history?.canGoForward() ?? false,
      zoom: contents?.getZoomFactor() ?? 1,
      device: this.device,
      colorScheme: this.colorScheme,
      error: this.error,
      navigation: this.navigation,
      picking: this.picking,
    };
  }

  show(rect: BrowserRect): BrowserState {
    this.rect = rect;
    this.shown = true;
    const view = this.ensure();
    this.layout();
    view.setVisible(this.window?.isMinimized() !== true);
    return this.state();
  }

  hide(): void {
    this.shown = false;
    this.view?.setVisible(false);
  }

  async snapshot(): Promise<string | null> {
    const contents = this.view?.webContents;
    if (contents === undefined || contents.getURL() === "" || this.error !== null) return null;
    const image = await contents.capturePage();
    return image.isEmpty() ? null : image.toDataURL();
  }

  navigate(url: string): number {
    const contents = this.ensure().webContents;
    this.error = null;
    this.navigation += 1;
    // loadURL rejects for failed and aborted loads; did-fail-load records a real failure for the page.
    contents.loadURL(url).catch(() => undefined);
    this.emit();
    return this.navigation;
  }

  back(): void { this.view?.webContents.navigationHistory.goBack(); }
  forward(): void { this.view?.webContents.navigationHistory.goForward(); }

  reload(hard: boolean): void {
    const contents = this.view?.webContents;
    if (contents === undefined) return;
    this.error = null;
    if (hard) contents.reloadIgnoringCache();
    else contents.reload();
  }

  openDevTools(): void {
    this.view?.webContents.openDevTools({ mode: "detach" });
  }

  async setColorScheme(scheme: BrowserColorScheme): Promise<void> {
    this.colorScheme = scheme;
    await this.applyColorScheme();
    this.emit();
  }

  zoom(direction: BrowserZoom): number {
    const contents = this.view?.webContents;
    if (contents === undefined) return 1;
    const factor = nextZoom(contents.getZoomFactor(), direction);
    contents.setZoomFactor(factor);
    this.emit();
    return factor;
  }

  setDevice(device: BrowserDevice): void {
    this.device = device;
    this.layout();
    this.emit();
  }

  async clearCookies(): Promise<void> {
    await this.session().clearStorageData({ storages: ["cookies"] });
  }

  async clearCache(): Promise<void> {
    await this.session().clearCache();
  }

  async screenshot(): Promise<BrowserScreenshot> {
    const contents = this.view?.webContents;
    if (contents === undefined || contents.getURL() === "") throw new Error("No page to capture");
    const image = await contents.capturePage();
    const dir = this.deps.screenshotsDir();
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
    const file = uniqueFile(dir, `browser-${stamp}.png`);
    writeFileSync(file, image.toPNG());
    const { width, height } = image.getSize();
    return { path: file, width, height };
  }

  /** Copies a screenshot this host saved; other paths are refused. */
  async copyImage(file: unknown): Promise<void> {
    if (typeof file !== "string") throw new Error("Screenshot path must be a string");
    const resolved = path.resolve(file);
    const dir = path.resolve(this.deps.screenshotsDir());
    if (path.dirname(resolved) !== dir || path.extname(resolved).toLowerCase() !== ".png") throw new Error("Not a browser screenshot");
    const png = readFileSync(resolved);
    await clipboard.write([new ClipboardItem({ "image/png": new Blob([png], { type: "image/png" }) })]);
  }

  async pick(): Promise<PickedElement | null> {
    const contents = this.view?.webContents;
    if (contents === undefined || contents.getURL() === "") throw new Error("No page to pick from");
    contents.focus();
    await contents.executeJavaScriptInIsolatedWorld(PICK_WORLD, [{ code: PICK_SCRIPT }], true);
    this.picking = true;
    this.emit();
    try {
      const result: unknown = await contents.executeJavaScriptInIsolatedWorld(PICK_WORLD, [{ code: PICK_RESULT_SCRIPT }], true);
      return result === null || typeof result !== "object" ? null : result as PickedElement;
    } finally {
      this.picking = false;
      this.emit();
    }
  }

  async cancelPick(): Promise<void> {
    const contents = this.view?.webContents;
    if (contents !== undefined) await contents.executeJavaScriptInIsolatedWorld(PICK_WORLD, [{ code: CANCEL_PICK_SCRIPT }]);
  }

  dispose(): void {
    const view = this.view;
    this.view = null;
    if (view === null) return;
    if (this.window !== null && !this.window.isDestroyed()) this.window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  private session(): Session {
    const value = session.fromPartition(BROWSER_PARTITION);
    if (!this.sessionReady) {
      this.sessionReady = true;
      value.setPermissionRequestHandler((_contents, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
      value.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission));
      value.on("will-download", (_event, item) => {
        const dir = this.deps.downloadsDir();
        mkdirSync(dir, { recursive: true });
        item.setSavePath(uniqueFile(dir, item.getFilename()));
      });
    }
    return value;
  }

  private ensure(): WebContentsView {
    const window = this.deps.getWindow();
    if (window === null || window.isDestroyed()) throw new Error("No app window for the browser");
    if (this.view !== null && this.window === window) return this.view;
    this.dispose();
    const view = new WebContentsView({
      webPreferences: { session: this.session(), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, spellcheck: false },
    });
    view.setVisible(false);
    view.setBackgroundColor("#ffffffff");
    window.contentView.addChildView(view);
    const contents = view.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) this.navigate(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => { if (!/^(https?:|about:blank)/i.test(url)) event.preventDefault(); });
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.on("did-start-navigation", (details) => { if (details.isMainFrame && !details.isSameDocument) this.error = null; this.emit(); });
    contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === ERR_ABORTED) return;
      this.error = { code, description, url };
      this.emit();
    });
    for (const name of ["did-start-loading", "did-stop-loading", "did-navigate", "did-navigate-in-page", "page-title-updated", "zoom-changed"] as const) {
      contents.on(name as "did-start-loading", () => this.emit());
    }
    contents.on("dom-ready", () => { void this.applyColorScheme(); });
    const onMinimize = (): void => view.setVisible(false);
    const onRestore = (): void => view.setVisible(this.shown);
    window.on("minimize", onMinimize);
    window.on("restore", onRestore);
    window.once("closed", () => {
      if (this.view === view) { this.view = null; this.window = null; }
    });
    this.view = view;
    this.window = window;
    return view;
  }

  /** The panel rect in window DIPs; a tablet or mobile preset narrows the page to its width and centers it. */
  private layout(): void {
    const view = this.view;
    const rect = this.rect;
    if (view === null || rect === null || this.window === null) return;
    const zoom = this.window.webContents.getZoomFactor();
    const preset = this.device === "desktop" ? null : BROWSER_DEVICE_WIDTHS[this.device];
    const width = preset === null ? rect.width : Math.min(preset, rect.width);
    const x = rect.x + (rect.width - width) / 2;
    // Presets resize the view itself: Chromium's device emulation leaves captures at the panel's full width.
    view.setBounds({ x: Math.round(x * zoom), y: Math.round(rect.y * zoom), width: Math.round(width * zoom), height: Math.round(rect.height * zoom) });
  }

  private async applyColorScheme(): Promise<void> {
    const contents = this.view?.webContents;
    if (contents === undefined || contents.isDestroyed()) return;
    if (this.colorScheme === "system" && !contents.debugger.isAttached()) return;
    if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
    await contents.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: this.colorScheme === "system" ? "" : this.colorScheme }],
    });
  }

  private emit(): void {
    const window = this.window;
    if (window !== null && !window.isDestroyed()) window.webContents.send(BROWSER_IPC.state, this.state());
  }
}
