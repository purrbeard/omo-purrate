/** The in-app browser dock surface: a main-process WebContentsView the renderer positions over its panel. */

/** A rectangle in the app window's CSS pixels (the renderer's coordinate space). */
export interface BrowserRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BrowserDevice = "desktop" | "tablet" | "mobile";
export type BrowserColorScheme = "system" | "light" | "dark";
export type BrowserZoom = "in" | "out" | "reset";

/** Viewport widths of the device toolbar presets; desktop fills the panel. */
export const BROWSER_DEVICE_WIDTHS: Record<Exclude<BrowserDevice, "desktop">, number> = { tablet: 768, mobile: 390 };

export interface BrowserLoadError {
  code: number;
  description: string;
  url: string;
}

export interface BrowserState {
  /** The page's current URL; "" before the first navigation. */
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Page zoom factor, 1 for 100%. */
  zoom: number;
  device: BrowserDevice;
  colorScheme: BrowserColorScheme;
  /** The main frame failed to load; cleared by the next navigation. */
  error: BrowserLoadError | null;
  /** Id of the latest browserNavigate call; states from before a navigation carry a smaller id. */
  navigation: number;
  /** The element picker is armed in the page. */
  picking: boolean;
}

export interface PickedElement {
  tag: string;
  selector: string;
  text: string;
  rect: BrowserRect;
}

export interface BrowserScreenshot {
  path: string;
  width: number;
  height: number;
}

export interface LocalServer {
  port: number;
  pid: number | null;
  url: string;
  /** HTTP status of a 1 s HEAD probe, or null when nothing answered. */
  status: number | null;
}

export const BROWSER_IPC = {
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
} as const;

export interface BrowserBridgeApi {
  /** Attaches the page view over `rect` and shows it; returns the current state. */
  browserShow(rect: BrowserRect): Promise<BrowserState>;
  /** Hides the page view; the page keeps its state. */
  browserHide(): Promise<void>;
  /** A PNG data URL of the visible page, or null when there is none; used as a still while an overlay covers the panel. */
  browserSnapshot(): Promise<string | null>;
  /** Starts loading an http(s) URL (or about:blank) in the page view, creating it hidden when needed; returns the navigation id. */
  browserNavigate(url: string): Promise<number>;
  browserBack(): Promise<void>;
  browserForward(): Promise<void>;
  /** `hard` reloads bypassing the cache. */
  browserReload(hard: boolean): Promise<void>;
  /** Opens DevTools for the page in a detached window. */
  browserOpenDevTools(): Promise<void>;
  /** Emulates prefers-color-scheme for the page; "system" removes the emulation. */
  browserSetColorScheme(scheme: BrowserColorScheme): Promise<void>;
  /** @returns the new zoom factor */
  browserZoom(direction: BrowserZoom): Promise<number>;
  browserSetDevice(device: BrowserDevice): Promise<void>;
  browserClearCookies(): Promise<void>;
  browserClearCache(): Promise<void>;
  /** Saves a PNG of the page under userData/screenshots. */
  browserScreenshot(): Promise<BrowserScreenshot>;
  /** Copies a screenshot saved by browserScreenshot to the clipboard as an image. */
  browserCopyImage(path: string): Promise<void>;
  /** Highlights elements under the pointer; resolves with the clicked one, or null when cancelled (Escape). */
  browserPickElement(): Promise<PickedElement | null>;
  browserCancelPick(): Promise<void>;
  /** Listening localhost TCP ports in common dev ranges, each probed with a 1 s HTTP HEAD. */
  listLocalServers(): Promise<LocalServer[]>;
  onBrowserState(listener: (state: BrowserState) => void): () => void;
}
