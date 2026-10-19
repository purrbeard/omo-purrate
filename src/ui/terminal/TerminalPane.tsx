import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { TerminalStream } from "../../../shared/workbench";
import { isTerminalShortcut } from "../shell/RightDock";
import { useUiState } from "../ui-state";
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

/** Shell output is raw PTY data; stderr and system notes are tinted and get CRLF line ends. */
function streamText(stream: TerminalStream, text: string): string {
  switch (stream) {
    case "stdout": return text;
    case "stderr": return `\x1b[31m${text.replace(/\r?\n/g, "\r\n")}\x1b[39m`;
    case "system": return `\x1b[2m${text.replace(/\r?\n/g, "\r\n")}\x1b[22m`;
    default: { const unknown: never = stream; throw new Error(`Unknown terminal stream ${String(unknown)}`); }
  }
}

export function errorText(error: unknown): string {
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

export interface PaneStatus {
  running: boolean;
  opening: boolean;
}

interface TerminalPaneProps {
  threadId: string;
  terminalId: string;
  cwd: string;
  /** The pane receiving focus and the panel's actions; it carries the focus ring when panes share the panel. */
  active: boolean;
  /** Draws the active ring: only meaningful when more than one pane is on screen. */
  ring: boolean;
  /** Bumped by a restart: the pane opens a fresh shell. */
  revision: number;
  /** Changes when the panel moves, so the active pane takes focus in its new place. */
  placement: string;
  onActivate(): void;
  onStatus(status: PaneStatus): void;
  /** Receives a writer that prints a failed panel request into this pane, or null on unmount. */
  onReporter(report: ((error: unknown) => void) | null): void;
}

/**
 * One shell's xterm: attaches to (threadId, terminalId), replays its snapshot, forwards keystrokes and resizes, and
 * keeps fitting its box as panes split, the drawer resizes or the panel moves.
 */
export function TerminalPane({ threadId, terminalId, cwd, active, ring, revision, placement, onActivate, onStatus, onReporter }: TerminalPaneProps) {
  const [status, setStatus] = useState<PaneStatus>({ running: false, opening: true });
  const outputRef = useRef<TerminalOutputElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const { preferences } = useUiState();
  const sizePreference = preferences?.terminalFontSize ?? null;
  const cursorBlink = preferences?.terminalCursorBlink ?? true;
  /** Read when a terminal is created, so changing the preferences updates open terminals without recreating them. */
  const optionsRef = useRef({ sizePreference, cursorBlink });
  optionsRef.current = { sizePreference, cursorBlink };
  /** The options xterm is running with, mirrored on the pane root for e2e. */
  const [applied, setApplied] = useState<{ fontSize: number; cursorBlink: boolean } | null>(null);
  /** Set once the snapshot is written and cleared on exit: keystrokes and resizes go to the live shell only. */
  const liveRef = useRef(false);
  /** Keystroke writes run one after another so slices of a paste and the keys after it arrive in order. */
  const writesRef = useRef<Promise<void>>(Promise.resolve());
  const callbacks = useRef({ onStatus, onReporter });
  callbacks.current = { onStatus, onReporter };

  useEffect(() => { callbacks.current.onStatus(status); }, [status]);
  useEffect(() => {
    callbacks.current.onReporter(error => terminalRef.current?.write(errorText(error)));
    return () => callbacks.current.onReporter(null);
  }, []);

  useEffect(() => {
    const host = outputRef.current;
    if (host === null) return;
    const font = readTerminalFont(host);
    const terminal = new Terminal({
      ...font,
      fontSize: optionsRef.current.sizePreference ?? font.fontSize,
      theme: readTerminalTheme(host),
      cursorBlink: optionsRef.current.cursorBlink,
      scrollback: 5000,
      // WCAG AA: shells pick ANSI colors for dark backgrounds, so xterm lifts low-contrast text on the light theme.
      minimumContrastRatio: 4.5,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    // xterm cancels every key it handles (Escape and Ctrl+L included reach the shell); the terminal toggle stays an app shortcut.
    terminal.attachCustomKeyEventHandler(event => !isTerminalShortcut(event));
    terminal.open(host);
    fit.fit();
    terminalRef.current = terminal;
    fitRef.current = fit;
    setApplied({ fontSize: terminal.options.fontSize ?? font.fontSize, cursorBlink: terminal.options.cursorBlink ?? true });
    if (EXPOSE_TERMINAL) {
      Object.defineProperty(host, "terminal", { value: terminal, configurable: true });
      host.dispatchEvent(new CustomEvent("terminal-ready"));
    }
    const report = (error: unknown): void => { if (terminalRef.current === terminal) terminal.write(errorText(error)); };
    const input = terminal.onData(data => {
      if (!liveRef.current) return;
      for (const part of slices(data)) {
        writesRef.current = writesRef.current.then(() => window.omo.terminalWrite(threadId, terminalId, part)).catch(report);
      }
    });
    const resize = terminal.onResize(({ cols, rows }) => {
      if (liveRef.current) window.omo.terminalResize(threadId, terminalId, cols, rows).catch(report);
    });
    let frame = 0;
    const sizer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit(); });
    });
    sizer.observe(host);
    // Scheme and palette are body attributes; the tokens behind the theme change with them.
    const themer = new MutationObserver(() => { terminal.options.theme = readTerminalTheme(host); });
    themer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme", "data-palette"] });
    void document.fonts.load(`${font.fontSize}px ${font.fontFamily}`).then(() => {
      if (terminalRef.current !== terminal) return;
      // xterm measures its cell only when a font option changes, so a web font that finishes loading after open needs one.
      terminal.options.fontFamily = "monospace";
      terminal.options.fontFamily = font.fontFamily;
      fit.fit();
    }, report);

    liveRef.current = false;
    setStatus({ running: false, opening: true });
    let attached = true;
    let exited = false;
    // Live chunks queue until the snapshot lands; then only chunks past the last written sequence are printed, so output
    // that raced the open reply is neither lost nor repeated.
    let written: number | null = null;
    const queued: { sequence: number; stream: TerminalStream; text: string }[] = [];
    const mine = (event: { threadId: string; terminalId: string }): boolean => attached && event.threadId === threadId && event.terminalId === terminalId;
    const unsubscribeChunk = window.omo.onTerminalChunk(chunk => {
      if (!mine(chunk)) return;
      if (written === null) { queued.push(chunk); return; }
      if (chunk.sequence <= written) return;
      written = chunk.sequence;
      terminal.write(streamText(chunk.stream, chunk.text));
    });
    const unsubscribeExit = window.omo.onTerminalExit(exit => {
      if (!mine(exit)) return;
      exited = true;
      liveRef.current = false;
      setStatus({ running: false, opening: false });
    });
    window.omo.terminalOpen(threadId, terminalId, cwd).then(snapshot => {
      if (!attached) return;
      if (snapshot.windowsBuild !== undefined) terminal.options.windowsPty = { backend: "conpty", buildNumber: snapshot.windowsBuild };
      // Replies xterm emits while parsing the replay would answer queries the shell sent long ago, so input (and
      // data-running) opens only once the replay is parsed; xterm parses later writes, and answers them, after it.
      terminal.write(snapshot.output.map(chunk => streamText(chunk.stream, chunk.text)).join(""), () => {
        if (!attached) return;
        const running = snapshot.running && !exited;
        liveRef.current = running;
        setStatus({ running, opening: false });
        if (running) window.omo.terminalResize(threadId, terminalId, terminal.cols, terminal.rows).catch(report);
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
      if (!attached) return;
      terminal.write(errorText(error));
      setStatus({ running: false, opening: false });
    });
    return () => {
      attached = false;
      liveRef.current = false;
      unsubscribeChunk();
      unsubscribeExit();
      cancelAnimationFrame(frame);
      sizer.disconnect();
      themer.disconnect();
      input.dispose();
      resize.dispose();
      if (EXPOSE_TERMINAL) Reflect.deleteProperty(host, "terminal");
      terminalRef.current = null;
      fitRef.current = null;
      terminal.dispose();
    };
  }, [threadId, terminalId, cwd, revision]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const host = outputRef.current;
    if (terminal === null || host === null) return;
    const fontSize = sizePreference ?? readTerminalFont(host).fontSize;
    terminal.options.fontSize = fontSize;
    terminal.options.cursorBlink = cursorBlink;
    if (host.clientWidth > 0 && host.clientHeight > 0) fitRef.current?.fit();
    setApplied({ fontSize, cursorBlink });
  }, [sizePreference, cursorBlink]);

  useEffect(() => { if (active) terminalRef.current?.focus(); }, [active, placement]);
  useEffect(() => { if (active && status.running) terminalRef.current?.focus(); }, [active, status.running]);

  return (
    <div className="box-border flex size-full min-h-0 min-w-0 rounded-md p-1.5 ring-1 ring-inset ring-transparent data-ring:ring-ring/60" data-testid="terminal-pane" data-terminal-id={terminalId}
      data-active={active || undefined} data-ring={(ring && active) || undefined} data-running={status.running} data-font-size={applied?.fontSize} data-cursor-blink={applied?.cursorBlink} onFocusCapture={() => { if (!active) onActivate(); }} onPointerDown={() => { if (!active) onActivate(); }}>
      <div ref={outputRef} className="min-h-0 min-w-0 flex-1 overflow-hidden font-mono leading-tight" data-testid="terminal-output" />
    </div>
  );
}
