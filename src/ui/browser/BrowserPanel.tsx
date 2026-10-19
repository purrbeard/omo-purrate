import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactElement, ReactNode } from "react";
import clsx from "clsx";
import {
  ArrowLeft, ArrowRight, Camera, Check, Code, Copy, ExternalLink, FolderOpen, Globe, History, House, Monitor, Moon, MousePointerClick,
  RotateCw, Server, Smartphone, Sun, SunMoon, Tablet, Trash2, Unplug, X, ZoomIn, ZoomOut, Ellipsis, Cookie, RefreshCcw,
} from "lucide-react";
import type { BrowserColorScheme, BrowserDevice, BrowserScreenshot, BrowserState, LocalServer } from "../../../shared/browser";
import { useT, type MessageKey } from "../../i18n";
import { selectMainThreadId } from "../../state";
import { useAppSelector } from "../app-context";
import { Badge, Button, focusRing, IconButton, Input, Menu, Tooltip } from "../kit";
import { modalSelector } from "../lib/modal-layer";
import { insertIntoComposer } from "../composer/draft-insert";
import { displayAddress, elementReference, resolveAddress } from "./address";
import { forgetThread, loadBrowserMemory, rememberUrl, saveBrowserMemory, type BrowserMemory } from "./browser-memory";

/**
 * The thread whose page the single main-process view holds, and the navigation that loaded it. It outlives the panel
 * so reopening the tab on the same thread keeps the page instead of reloading it.
 */
let owner: { threadId: string | null; navigation: number } | null = null;

const SCHEMES: { id: BrowserColorScheme; label: MessageKey; icon: ReactNode }[] = [
  { id: "system", label: "browser.scheme.system", icon: <SunMoon /> },
  { id: "light", label: "browser.scheme.light", icon: <Sun /> },
  { id: "dark", label: "browser.scheme.dark", icon: <Moon /> },
];
const DEVICES: { id: BrowserDevice; label: MessageKey; icon: ReactNode }[] = [
  { id: "desktop", label: "browser.device.desktop", icon: <Monitor /> },
  { id: "tablet", label: "browser.device.tablet", icon: <Tablet /> },
  { id: "mobile", label: "browser.device.mobile", icon: <Smartphone /> },
];

const rowClass = clsx(
  "m-0 box-border flex h-9 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 text-left text-sm text-foreground [font-family:inherit]",
  "hover:bg-accent [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
  focusRing,
);

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Tip({ label, children }: { label: string; children: ReactElement }) {
  // The page view is drawn above the app, so toolbar tips open upward, over the dock's tab strip.
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Content side="top">{label}</Tooltip.Content>
    </Tooltip.Root>
  );
}

export function BrowserPanel({ placement }: { placement: "docked" | "overlay" }) {
  const t = useT();
  const threadId = useAppSelector(selectMainThreadId);
  const [memory, setMemory] = useState<BrowserMemory>(loadBrowserMemory);
  const [state, setState] = useState<BrowserState | null>(null);
  const [page, setPage] = useState(() => owner !== null && owner.threadId === threadId ? memory.lastUrl[threadId ?? ""] !== undefined : false);
  const [address, setAddress] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [covered, setCovered] = useState(false);
  const [still, setStill] = useState<string | null>(null);
  const [shot, setShot] = useState<BrowserScreenshot | null>(null);
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [servers, setServers] = useState<LocalServer[] | null>(null);
  const [scan, setScan] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const headingId = useId();

  const remember = (next: BrowserMemory): void => { setMemory(next); saveBrowserMemory(next); };
  const say = (message: string): void => setNotice(message);
  const run = (work: Promise<unknown>): void => { work.catch((error: unknown) => say(errorText(error))); };

  useEffect(() => window.omo.onBrowserState(setState), []);

  /** Loads `url` for this thread and makes this thread the view's owner. */
  const open = (url: string): void => {
    setPage(true);
    setAddress(null);
    void window.omo.browserNavigate(url).then((navigation) => { owner = { threadId, navigation }; }, (error: unknown) => say(errorText(error)));
  };

  // A thread opens on its last page, or on the start page; the same thread keeps the page the view already holds.
  useEffect(() => {
    const url = threadId === null ? undefined : memory.lastUrl[threadId];
    setAddress(null);
    setShot(null);
    if (owner !== null && owner.threadId === threadId) { setPage(url !== undefined || page); return; }
    if (url === undefined) { setPage(false); owner = null; return; }
    open(url);
    // memory and page are read as of the switch; later changes are this thread's own navigation.
  }, [threadId]);

  // The page this thread shows becomes its last URL and the newest recent entry once its navigation settles.
  useEffect(() => {
    if (state === null || !page || state.loading || state.error !== null || state.url === "" || owner === null || owner.threadId !== threadId || state.navigation < owner.navigation) return;
    if (memory.lastUrl[threadId ?? ""] === state.url && memory.recent[0] === state.url) return;
    remember(rememberUrl(memory, threadId, state.url));
  }, [state, page, threadId]);

  // A dialog or menu that is not the dock itself covers the panel; the native page view would draw over it.
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    let frame = 0;
    const check = (): void => {
      frame = 0;
      setCovered([...document.querySelectorAll(modalSelector)].some((element) => !element.contains(panel) && !panel.contains(element)));
    };
    const observer = new MutationObserver(() => { frame ||= requestAnimationFrame(check); });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["role", "aria-modal"] });
    check();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  const failed = state?.error ?? null;
  const showing = page && failed === null && state !== null && state.url !== "";
  const obscured = covered || menuOpen;
  const visible = page && failed === null && !obscured;

  // The page view follows the content rect while visible; when an overlay covers it, a still of the page stands in.
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (content === null) return;
    let active = true;
    if (!visible) {
      if (obscured && page && failed === null) {
        void window.omo.browserSnapshot().then((image) => { if (active) setStill(image); return window.omo.browserHide(); });
      } else {
        setStill(null);
        void window.omo.browserHide();
      }
      return () => { active = false; };
    }
    let frame = 0;
    const report = (): void => {
      frame = 0;
      const rect = content.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      void window.omo.browserShow({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }).then((next) => {
        if (!active) return;
        setState(next);
        setStill(null);
      });
    };
    const schedule = (): void => { frame ||= requestAnimationFrame(report); };
    report();
    const observer = new ResizeObserver(schedule);
    observer.observe(content);
    window.addEventListener("resize", schedule);
    document.addEventListener("transitionend", schedule, true);
    return () => {
      active = false;
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("transitionend", schedule, true);
    };
  }, [visible, obscured, page, failed === null]);

  useEffect(() => () => { void window.omo.browserHide(); void window.omo.browserCancelPick(); }, []);

  useEffect(() => {
    if (page) return;
    let active = true;
    setServers(null);
    window.omo.listLocalServers().then((found) => { if (active) setServers(found); }, (error: unknown) => { if (active) { setServers([]); say(errorText(error)); } });
    return () => { active = false; };
  }, [page, scan]);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const url = resolveAddress(address ?? "");
    inputRef.current?.blur();
    if (url === null) { goHome(); return; }
    open(url);
  };
  const onAddressKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setAddress(null);
    event.currentTarget.blur();
  };
  const goHome = (): void => {
    setPage(false);
    setAddress(null);
    owner = { threadId, navigation: state?.navigation ?? 0 };
    remember(forgetThread(memory, threadId));
  };
  const pick = async (): Promise<void> => {
    setPicking(true);
    try {
      const element = await window.omo.browserPickElement();
      if (element !== null) {
        insertIntoComposer(elementReference(element.selector, element.text));
        say(t("browser.pick.inserted"));
      }
    } catch (error) { say(errorText(error)); }
    finally { setPicking(false); }
  };
  const screenshot = async (): Promise<void> => {
    try { setShot(await window.omo.browserScreenshot()); } catch (error) { say(errorText(error)); }
  };

  const zoom = state?.zoom ?? 1;
  const device = state?.device ?? "desktop";
  const scheme = state?.colorScheme ?? "system";
  const shown = address ?? (page ? displayAddress(state?.url ?? "") : "");
  const check = (on: boolean): ReactNode => on ? <Check /> : <span aria-hidden className="size-4 shrink-0" />;

  return (
    <aside ref={panelRef} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-solid border-border bg-card text-sm text-foreground data-[placement=overlay]:shadow-lg"
      data-testid="browser-panel" data-placement={placement} aria-labelledby={headingId} tabIndex={-1}
      data-url={showing ? state.url : undefined} data-zoom={zoom} data-device={device} data-scheme={scheme} data-page-visible={visible && showing}>
      <h2 id={headingId} className="sr-only">{t("browser.title")}</h2>
      <div className="flex shrink-0 items-center gap-0.5 border-0 border-b border-solid border-border p-1">
        <Tip label={t("browser.back")}><IconButton icon={<ArrowLeft />} label={t("browser.back")} data-testid="browser-back" disabled={!showing || state.canGoBack !== true} onClick={() => run(window.omo.browserBack())} /></Tip>
        <Tip label={t("browser.forward")}><IconButton icon={<ArrowRight />} label={t("browser.forward")} data-testid="browser-forward" disabled={!showing || state.canGoForward !== true} onClick={() => run(window.omo.browserForward())} /></Tip>
        <Tip label={t("browser.reload")}><IconButton icon={<RotateCw />} label={t("browser.reload")} data-testid="browser-reload" disabled={!page} onClick={() => run(window.omo.browserReload(false))} /></Tip>
        <Tip label={t("browser.home")}><IconButton icon={<House />} label={t("browser.home")} data-testid="browser-home" disabled={!page} onClick={goHome} /></Tip>
        <form className="min-w-0 flex-1 px-1" onSubmit={submit} role="search">
          <Input ref={inputRef} className="h-8" data-testid="browser-address" value={shown} placeholder={t("browser.address.placeholder")} aria-label={t("browser.address.label")}
            spellCheck={false} autoComplete="off" onFocus={(event) => { setAddress(shown); event.currentTarget.select(); }} onBlur={() => setAddress(null)}
            onChange={(event) => setAddress(event.target.value)} onKeyDown={onAddressKey} />
        </form>
        <Tip label={t("browser.external")}><IconButton icon={<ExternalLink />} label={t("browser.external")} data-testid="browser-external" disabled={!showing} onClick={() => state !== null && run(window.omo.openExternal(state.url))} /></Tip>
        <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Menu.Trigger render={<IconButton icon={<Ellipsis />} label={t("browser.tools")} data-testid="browser-tools" />} />
          <Menu.Content align="end" className="w-60" data-testid="browser-tools-menu">
            <Menu.Item icon={<Code />} data-testid="browser-devtools" disabled={!showing} onClick={() => run(window.omo.browserOpenDevTools())}>{t("browser.devtools")}</Menu.Item>
            <Menu.Item icon={<MousePointerClick />} data-testid="browser-pick" disabled={!showing} onClick={() => void pick()}>{t("browser.pick")}</Menu.Item>
            <Menu.Item icon={<Camera />} data-testid="browser-screenshot" disabled={!showing} onClick={() => void screenshot()}>{t("browser.screenshot")}</Menu.Item>
            <Menu.Item icon={<RefreshCcw />} data-testid="browser-hard-reload" disabled={!page} onClick={() => run(window.omo.browserReload(true))}>{t("browser.hardReload")}</Menu.Item>
            <Menu.Separator />
            <Menu.Group>
              <Menu.GroupLabel>{t("browser.zoom", { percent: Math.round(zoom * 100) })}</Menu.GroupLabel>
              <Menu.Item icon={<ZoomIn />} data-testid="browser-zoom-in" disabled={!showing} onClick={() => run(window.omo.browserZoom("in"))}>{t("browser.zoom.in")}</Menu.Item>
              <Menu.Item icon={<ZoomOut />} data-testid="browser-zoom-out" disabled={!showing} onClick={() => run(window.omo.browserZoom("out"))}>{t("browser.zoom.out")}</Menu.Item>
              <Menu.Item icon={check(false)} data-testid="browser-zoom-reset" disabled={!showing || zoom === 1} onClick={() => run(window.omo.browserZoom("reset"))}>{t("browser.zoom.reset")}</Menu.Item>
            </Menu.Group>
            <Menu.Separator />
            <Menu.Group>
              <Menu.GroupLabel>{t("browser.scheme")}</Menu.GroupLabel>
              {SCHEMES.map(({ id, label, icon }) => (
                <Menu.Item key={id} icon={icon} data-testid={`browser-scheme-${id}`} aria-checked={scheme === id} role="menuitemradio" onClick={() => run(window.omo.browserSetColorScheme(id))}>
                  <span className="min-w-0 flex-1">{t(label)}</span>{check(scheme === id)}
                </Menu.Item>
              ))}
            </Menu.Group>
            <Menu.Separator />
            <Menu.Group>
              <Menu.GroupLabel>{t("browser.device")}</Menu.GroupLabel>
              {DEVICES.map(({ id, label, icon }) => (
                <Menu.Item key={id} icon={icon} data-testid={`browser-device-${id}`} aria-checked={device === id} role="menuitemradio" onClick={() => run(window.omo.browserSetDevice(id))}>
                  <span className="min-w-0 flex-1">{t(label)}</span>{check(device === id)}
                </Menu.Item>
              ))}
            </Menu.Group>
            <Menu.Separator />
            <Menu.Item icon={<Cookie />} data-testid="browser-clear-cookies" onClick={() => run(window.omo.browserClearCookies().then(() => say(t("browser.cookiesCleared"))))}>{t("browser.clearCookies")}</Menu.Item>
            <Menu.Item icon={<Trash2 />} data-testid="browser-clear-cache" onClick={() => run(window.omo.browserClearCache().then(() => say(t("browser.cacheCleared"))))}>{t("browser.clearCache")}</Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </div>
      <div ref={contentRef} className={clsx("relative min-h-0 flex-1 overflow-hidden", device === "desktop" || !page ? "bg-background" : "bg-muted")} data-testid="browser-content">
        {page && state?.loading === true && <div aria-hidden className="absolute inset-x-0 top-0 z-1 h-0.5 animate-pulse bg-primary" data-testid="browser-loading" />}
        {!page ? <StartPage servers={servers} recent={memory.recent} onOpen={open} onRescan={() => setScan((value) => value + 1)} />
          : failed !== null ? <LoadError url={failed.url} detail={`${failed.description} (${failed.code})`} onReload={() => run(window.omo.browserReload(false))} />
          : still !== null && <img src={still} alt="" aria-hidden className="pointer-events-none absolute top-0 left-1/2 h-full -translate-x-1/2 object-contain object-top select-none" draggable={false} />}
      </div>
      {picking && (
        <div className="flex shrink-0 items-center gap-2 border-0 border-t border-solid border-border bg-accent px-3 py-2 text-xs" data-testid="browser-pick-bar" role="status" data-armed={state?.picking === true || undefined}>
          <MousePointerClick aria-hidden className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">{t("browser.pick.hint")}</span>
          <Button variant="secondary" size="sm" data-testid="browser-pick-cancel" onClick={() => run(window.omo.browserCancelPick())}>{t("browser.cancel")}</Button>
        </div>
      )}
      {shot !== null && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-0 border-t border-solid border-border px-3 py-2 text-xs" data-testid="browser-shot-bar" data-path={shot.path}>
          <Camera aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate" title={shot.path}>{t("browser.shot.saved", { name: shot.path.split(/[\\/]/).at(-1) ?? shot.path })}</span>
          <Button variant="secondary" size="sm" icon={<Copy />} data-testid="browser-copy-image" onClick={() => run(window.omo.browserCopyImage(shot.path).then(() => say(t("browser.shot.imageCopied"))))}>{t("browser.shot.copyImage")}</Button>
          <Button variant="ghost" size="sm" data-testid="browser-copy-path" onClick={() => run(window.omo.copyText(shot.path).then(() => say(t("browser.shot.pathCopied"))))}>{t("browser.shot.copyPath")}</Button>
          <IconButton icon={<FolderOpen />} label={t("browser.shot.reveal")} className="size-8!" onClick={() => run(window.omo.revealPath(shot.path))} />
          <IconButton icon={<X />} label={t("browser.shot.dismiss")} className="size-8!" onClick={() => setShot(null)} />
        </div>
      )}
      {notice !== null && <p className="m-0 shrink-0 border-0 border-t border-solid border-border px-3 py-2 text-xs text-muted-foreground" data-testid="browser-notice" role="status">{notice}</p>}
    </aside>
  );
}

function StartPage({ servers, recent, onOpen, onRescan }: { servers: LocalServer[] | null; recent: string[]; onOpen(url: string): void; onRescan(): void }) {
  const t = useT();
  return (
    <div className="box-border flex h-full flex-col gap-6 overflow-auto p-4" data-testid="browser-start">
      <section aria-labelledby="browser-local-servers" className="flex flex-col gap-1">
        <div className="flex items-center gap-2 px-2.5">
          <h3 id="browser-local-servers" className="m-0 flex-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("browser.local.title")}</h3>
          <IconButton icon={<RotateCw />} label={t("browser.local.rescan")} className="size-7!" data-testid="browser-local-rescan" disabled={servers === null} onClick={onRescan} />
        </div>
        {servers === null ? <p className="m-0 px-2.5 py-2 text-xs text-muted-foreground" role="status">{t("browser.local.scanning")}</p>
          : servers.length === 0 ? <p className="m-0 px-2.5 py-2 text-xs text-muted-foreground">{t("browser.local.empty")}</p>
          : <ul className="m-0 flex list-none flex-col gap-0.5 p-0">{servers.map((server) => (
            <li key={server.port}>
              <button type="button" className={rowClass} data-testid="browser-local-server" data-port={server.port} onClick={() => onOpen(server.url)}>
                <Server aria-hidden />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">localhost:{server.port}</span>
                {server.pid !== null && <span className="text-xs text-muted-foreground tabular-nums">{t("browser.local.pid", { pid: server.pid })}</span>}
                {server.status === null ? <Badge variant="outline">{t("browser.local.silent")}</Badge>
                  : <Badge variant={server.status < 400 ? "success" : "warning"}>{server.status}</Badge>}
              </button>
            </li>
          ))}</ul>}
      </section>
      <section aria-labelledby="browser-recent" className="flex flex-col gap-1">
        <h3 id="browser-recent" className="m-0 px-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("browser.recent.title")}</h3>
        {recent.length === 0 ? <p className="m-0 px-2.5 py-2 text-xs text-muted-foreground">{t("browser.recent.empty")}</p>
          : <ul className="m-0 flex list-none flex-col gap-0.5 p-0">{recent.map((url) => (
            <li key={url}>
              <button type="button" className={rowClass} data-testid="browser-recent-row" title={url} onClick={() => onOpen(url)}>
                <History aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs">{displayAddress(url)}</span>
              </button>
            </li>
          ))}</ul>}
      </section>
      <p className="m-0 mt-auto flex items-center gap-2 px-2.5 text-xs text-muted-foreground"><Globe aria-hidden className="size-3.5 shrink-0" />{t("browser.start.hint")}</p>
    </div>
  );
}

function LoadError({ url, detail, onReload }: { url: string; detail: string; onReload(): void }) {
  const t = useT();
  return (
    <div className="box-border flex h-full flex-col items-center justify-center gap-3 p-6 text-center" data-testid="browser-error" role="alert">
      <Unplug aria-hidden className="size-8 text-muted-foreground" />
      <h3 className="m-0 text-base font-semibold">{t("browser.error.title")}</h3>
      <p className="m-0 max-w-full truncate font-mono text-xs text-muted-foreground" title={url}>{displayAddress(url)}</p>
      <p className="m-0 text-xs text-muted-foreground">{detail}</p>
      <Button variant="secondary" size="sm" icon={<RotateCw />} data-testid="browser-error-reload" onClick={onReload}>{t("browser.reload")}</Button>
    </div>
  );
}
