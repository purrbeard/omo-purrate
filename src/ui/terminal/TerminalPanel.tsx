import { useEffect, useId, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { TerminalStream } from "../../../shared/workbench";
import { Button } from "../kit";
import { useT } from "../../i18n";
import { selectMainThreadId } from "../../state";
import { useAppSelector } from "../app-context";
import { isTerminalShortcut } from "../shell/RightDock";
import { readTerminalFont, readTerminalTheme } from "./terminal-theme";

/** The element xterm opens into. Outside a packaged app it also carries the public xterm instance for e2e assertions. */
type TerminalOutputElement = HTMLDivElement & { readonly terminal?: Terminal };

/**
 * The dev server and unpackaged runs (e2e launches the built renderer from the working tree) expose the test hook; a
 * packaged app loads its renderer from app.asar and never does.
 */
const EXPOSE_TERMINAL = import.meta.env.DEV || !window.location.pathname.includes("/app.asar/");

/** The bridge rejects longer writes, so a large paste is sent as consecutive slices. */
const MAX_WRITE = 8000;

/** The single shell this panel opens per thread. */
const TERMINAL_ID = "t1";

/** Shell output is raw PTY data; stderr and system notes are tinted and get CRLF line ends. */
function streamText(stream: TerminalStream, text: string): string {
  switch (stream) {
    case "stdout": return text;
    case "stderr": return `\x1b[31m${text.replace(/\r?\n/g, "\r\n")}\x1b[39m`;
    case "system": return `\x1b[2m${text.replace(/\r?\n/g, "\r\n")}\x1b[22m`;
    default: { const unknown: never = stream; throw new Error(`Unknown terminal stream ${String(unknown)}`); }
  }
}

function errorText(error: unknown): string {
  return streamText("system", `${error instanceof Error ? error.message : String(error)}\n`);
}

/** Splits `data` into bridge-sized slices without separating a surrogate pair. */
function slices(data: string): string[] {
  const parts: string[] = [];
  for (let start = 0; start < data.length;) {
    let end = Math.min(start + MAX_WRITE, data.length);
    const last = data.charCodeAt(end - 1);
    if (end < data.length && last >= 0xd800 && last <= 0xdbff) end--;
    parts.push(data.slice(start, end));
    start = end;
  }
  return parts;
}

export function TerminalPanel({ placement }: { placement: "docked" | "overlay" }) {
  const t = useT();
  const threadId = useAppSelector(selectMainThreadId);
  const cwd = useAppSelector(state => threadId === null ? undefined : state.threads[threadId]?.cwd);
  const [status, setStatus] = useState<{ threadId: string | null; running: boolean }>({ threadId: null, running: false });
  const [revision, setRevision] = useState(0);
  const [opening, setOpening] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const outputRef = useRef<TerminalOutputElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  /** Thread whose live shell receives keystrokes and resizes: set once its snapshot is written, cleared on exit or switch. */
  const shellRef = useRef<string | null>(null);
  /** Keystroke writes run one after another so slices of a paste and the keys after it arrive in order. */
  const writesRef = useRef<Promise<void>>(Promise.resolve());
  const headingId = useId();
  const running = status.threadId === threadId && status.running;

  /** Prints a failed request into the terminal unless the panel has moved to another thread since. */
  const report = (id: string, error: unknown): void => {
    if (panelRef.current?.dataset.threadId === id) terminalRef.current?.write(errorText(error));
  };

  useEffect(() => {
    const panel = panelRef.current;
    const host = outputRef.current;
    if (panel === null || host === null) return;
    const font = readTerminalFont(host);
    const terminal = new Terminal({
      ...font,
      theme: readTerminalTheme(panel),
      cursorBlink: true,
      scrollback: 5000,
      // WCAG AA: shells pick ANSI colors for dark backgrounds, so xterm lifts low-contrast text on the light theme.
      minimumContrastRatio: 4.5,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    // xterm cancels every key it handles (Escape and Ctrl+L included reach the shell); the dock toggle stays an app shortcut.
    terminal.attachCustomKeyEventHandler(event => !isTerminalShortcut(event));
    terminal.open(host);
    fit.fit();
    terminalRef.current = terminal;
    if (EXPOSE_TERMINAL) {
      Object.defineProperty(host, "terminal", { value: terminal, configurable: true });
      host.dispatchEvent(new CustomEvent("terminal-ready"));
    }
    const input = terminal.onData(data => {
      const id = shellRef.current;
      if (id === null) return;
      for (const part of slices(data)) {
        writesRef.current = writesRef.current.then(() => window.omo.terminalWrite(id, TERMINAL_ID, part)).catch(error => report(id, error));
      }
    });
    const resize = terminal.onResize(({ cols, rows }) => {
      const id = shellRef.current;
      if (id !== null) window.omo.terminalResize(id, TERMINAL_ID, cols, rows).catch(error => report(id, error));
    });
    let frame = 0;
    const sizer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit(); });
    });
    sizer.observe(host);
    // Scheme and palette are body attributes; the tokens behind the theme change with them.
    const themer = new MutationObserver(() => { terminal.options.theme = readTerminalTheme(panel); });
    themer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme", "data-palette"] });
    void document.fonts.load(`${font.fontSize}px ${font.fontFamily}`).then(() => {
      if (terminalRef.current !== terminal) return;
      // xterm measures its cell only when a font option changes, so a web font that finishes loading after open needs one.
      terminal.options.fontFamily = "monospace";
      terminal.options.fontFamily = font.fontFamily;
      fit.fit();
    }, (error: unknown) => { if (terminalRef.current === terminal) terminal.write(errorText(error)); });
    return () => {
      cancelAnimationFrame(frame);
      sizer.disconnect();
      themer.disconnect();
      input.dispose();
      resize.dispose();
      if (EXPOSE_TERMINAL) Reflect.deleteProperty(host, "terminal");
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [threadId, cwd, revision]);

  useEffect(() => {
    if (outputRef.current?.hidden === false) terminalRef.current?.focus();
    else panelRef.current?.focus();
  }, [placement]);
  useEffect(() => { if (running) terminalRef.current?.focus(); }, [running, threadId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal === null) return;
    terminal.reset();
    shellRef.current = null;
    setStatus({ threadId, running: false });
    if (threadId === null || cwd === undefined) { setOpening(false); return; }
    setOpening(true);
    let active = true;
    let exited = false;
    // Live chunks queue until the snapshot lands; then only chunks past the last written sequence are printed, so output
    // that raced the open reply is neither lost nor repeated.
    let written: number | null = null;
    const queued: { sequence: number; stream: TerminalStream; text: string }[] = [];
    const unsubscribeChunk = window.omo.onTerminalChunk(chunk => {
      if (!active || chunk.threadId !== threadId || chunk.terminalId !== TERMINAL_ID) return;
      if (written === null) { queued.push(chunk); return; }
      if (chunk.sequence <= written) return;
      written = chunk.sequence;
      terminal.write(streamText(chunk.stream, chunk.text));
    });
    const unsubscribeExit = window.omo.onTerminalExit(exit => {
      if (!active || exit.threadId !== threadId || exit.terminalId !== TERMINAL_ID) return;
      exited = true;
      shellRef.current = null;
      setStatus({ threadId, running: false });
    });
    window.omo.terminalOpen(threadId, TERMINAL_ID, cwd).then(snapshot => {
      if (!active) return;
      if (snapshot.windowsBuild !== undefined) terminal.options.windowsPty = { backend: "conpty", buildNumber: snapshot.windowsBuild };
      // Replies xterm emits while parsing the replay would answer queries the shell sent long ago, so input (and
      // data-running) opens only once the replay is parsed; xterm parses later writes, and answers them, after it.
      terminal.write(snapshot.output.map(chunk => streamText(chunk.stream, chunk.text)).join(""), () => {
        if (!active) return;
        if (snapshot.running && !exited) {
          shellRef.current = threadId;
          setStatus({ threadId, running: true });
          window.omo.terminalResize(threadId, TERMINAL_ID, terminal.cols, terminal.rows).catch(error => report(threadId, error));
        }
        setOpening(false);
      });
      let last = snapshot.sequence;
      for (const chunk of queued) {
        if (chunk.sequence <= last) continue;
        last = chunk.sequence;
        terminal.write(streamText(chunk.stream, chunk.text));
      }
      queued.length = 0;
      written = last;
    }, error => {
      if (!active) return;
      terminal.write(errorText(error));
      setOpening(false);
    });
    return () => { active = false; shellRef.current = null; unsubscribeChunk(); unsubscribeExit(); };
  }, [threadId, cwd, revision]);

  const restart = async () => {
    if (threadId === null || cwd === undefined || opening) return;
    const id = threadId;
    setOpening(true);
    shellRef.current = null;
    setStatus({ threadId: id, running: false });
    try {
      await window.omo.terminalKill(id, TERMINAL_ID);
      if (panelRef.current?.dataset.threadId !== id) return;
      setRevision(current => current + 1);
    } catch (error) {
      if (panelRef.current?.dataset.threadId !== id) return;
      terminalRef.current?.write(errorText(error));
      setOpening(false);
    }
  };

  return <aside ref={panelRef} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-solid border-border bg-terminal text-xs text-terminal-foreground data-[placement=overlay]:shadow-lg" data-testid="terminal-panel" data-placement={placement} data-thread-id={threadId ?? undefined}
    data-running={running} aria-labelledby={headingId} tabIndex={-1}>
    <header className="flex items-center gap-2 border-0 border-b border-solid border-border p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1 [&>span]:truncate [&>span]:text-muted-foreground"><strong id={headingId} className="sr-only">{t("terminal.title")}</strong><span title={cwd}>{cwd?.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || cwd}</span></div>
      <Button variant="secondary" size="sm" data-testid="terminal-restart" disabled={threadId === null || cwd === undefined || opening} onClick={() => void restart()}>{t("terminal.restart")}</Button>
    </header>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3">
      {threadId === null && <p className="m-0 leading-normal text-muted-foreground">{t("terminal.empty")}</p>}
      <div ref={outputRef} className="min-h-0 min-w-0 flex-1 overflow-hidden font-mono leading-tight" data-testid="terminal-output" hidden={threadId === null} />
    </div>
    {threadId !== null && !running && !opening && <footer className="shrink-0 border-0 border-t border-solid border-border px-3 py-2"><p className="m-0 leading-normal text-muted-foreground">{t("terminal.stopped")}</p></footer>}
  </aside>;
}
