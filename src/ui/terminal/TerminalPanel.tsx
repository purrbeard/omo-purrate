import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TerminalChunk } from "../../../shared/workbench";
import { parseAnsiLines } from "../../dsh/primitives/ansi";
import { useT } from "../../i18n";
import { selectMainThreadId } from "../../state";
import { useAppSelector } from "../app-context";
import css from "./TerminalPanel.module.css";

export function TerminalPanel({ placement, onClose }: { placement: "docked" | "overlay"; onClose: () => void }) {
  const t = useT();
  const threadId = useAppSelector(selectMainThreadId);
  const cwd = useAppSelector(state => threadId === null ? undefined : state.threads[threadId]?.cwd);
  const [session, setSession] = useState<{ threadId: string | null; running: boolean; output: TerminalChunk[] }>({ threadId: null, running: false, output: [] });
  const [revision, setRevision] = useState(0);
  const [opening, setOpening] = useState(false);
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const draft = useRef("");
  const panelRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);
  const headingId = useId();
  const inputId = useId();
  const running = session.threadId === threadId && session.running;
  const output = session.threadId === threadId ? session.output : [];

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (inputRef.current?.disabled === false) inputRef.current.focus();
    else panelRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [placement]);

  useEffect(() => {
    let active = true;
    let ready = false;
    let exited = false;
    setSession({ threadId, running: false, output: [] });
    atBottom.current = true;
    if (threadId === null || cwd === undefined) { setOpening(false); return; }
    setOpening(true);
    const unsubscribeChunk = window.omo.onTerminalChunk(chunk => {
      if (!active || !ready || chunk.threadId !== threadId) return;
      setSession(current => ({ ...current, output: [...current.output, chunk].slice(-2000) }));
    });
    const unsubscribeExit = window.omo.onTerminalExit(exit => {
      if (!active || exit.threadId !== threadId) return;
      exited = true;
      setSession(current => ({ ...current, running: false }));
    });
    void window.omo.terminalOpen(threadId, cwd).then(snapshot => {
      if (!active) return;
      setSession({ threadId, running: snapshot.running && !exited, output: snapshot.output.slice(-2000) });
      ready = true;
      setOpening(false);
    }, error => {
      if (!active) return;
      setSession({ threadId, running: false, output: [{ threadId, stream: "system", text: `${error instanceof Error ? error.message : String(error)}\n` }] });
      setOpening(false);
    });
    return () => { active = false; unsubscribeChunk(); unsubscribeExit(); };
  }, [threadId, cwd, revision]);

  useEffect(() => { setValue(""); setHistory([]); setHistoryIndex(0); draft.current = ""; }, [threadId]);
  useEffect(() => { if (running) inputRef.current?.focus(); }, [running, threadId]);
  useLayoutEffect(() => {
    const region = outputRef.current;
    if (region !== null && atBottom.current) region.scrollTop = region.scrollHeight;
  }, [output]);

  const rendered = useMemo(() => {
    const groups: { stream: TerminalChunk["stream"]; text: string }[] = [];
    for (const chunk of output) {
      const last = groups.at(-1);
      if (last?.stream === chunk.stream) last.text += chunk.text;
      else groups.push({ stream: chunk.stream, text: chunk.text });
    }
    return groups.map((group, index) => <span key={index} className={group.stream === "stderr" ? css.stderr : group.stream === "system" ? css.system : undefined}>
      {parseAnsiLines(group.text).map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 && "\n"}{line.map((span, spanIndex) => span.style === undefined ? span.text : <span key={spanIndex} style={span.style}>{span.text}</span>)}</Fragment>)}
    </span>);
  }, [output]);

  const restart = async () => {
    if (threadId === null || cwd === undefined || opening) return;
    const id = threadId;
    setOpening(true);
    setSession(current => ({ ...current, running: false }));
    try {
      await window.omo.terminalKill(id);
      if (panelRef.current === null || panelRef.current.dataset.threadId !== id) return;
      setSession({ threadId: id, running: false, output: [] });
      atBottom.current = true;
      setRevision(current => current + 1);
    } catch (error) {
      if (panelRef.current === null || panelRef.current.dataset.threadId !== id) return;
      setSession(current => ({ ...current, output: [...current.output, { threadId: id, stream: "system" as const, text: `${error instanceof Error ? error.message : String(error)}\n` }].slice(-2000) }));
      setOpening(false);
    }
  };

  return <aside ref={panelRef} className={css.panel} data-testid="terminal-panel" data-placement={placement} data-thread-id={threadId ?? undefined}
    role={placement === "overlay" ? "dialog" : "complementary"} aria-modal={placement === "overlay" ? true : undefined} aria-labelledby={headingId} tabIndex={-1}
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.ctrlKey && event.key.toLowerCase() === "l") { event.preventDefault(); event.stopPropagation(); setSession(current => ({ ...current, output: [] })); atBottom.current = true; return; }
      if (event.key !== "Tab" || placement !== "overlay") return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]')];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { event.preventDefault(); first?.focus(); }
    }}>
    <header className={css.header}>
      <div className={css.heading}><strong id={headingId}>{t("terminal.title")}</strong><span title={cwd}>{cwd?.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || cwd}</span></div>
      <button type="button" data-testid="terminal-restart" disabled={threadId === null || cwd === undefined || opening} onClick={() => void restart()}>{t("terminal.restart")}</button>
      <button type="button" data-testid="terminal-close" aria-label={t("terminal.close")} onClick={onClose}>×</button>
    </header>
    <div ref={outputRef} className={css.body} data-testid="terminal-output" role="log" aria-live="polite" onScroll={event => {
      const region = event.currentTarget;
      atBottom.current = region.scrollHeight - region.scrollTop - region.clientHeight <= 4;
    }}>{threadId === null ? <p className={css.hint}>{t("terminal.empty")}</p> : rendered}</div>
    <footer className={css.footer}>
      <div className={css.command}><label htmlFor={inputId}>PS&gt;</label><input ref={inputRef} id={inputId} data-testid="terminal-input" aria-label={t("terminal.input")} autoComplete="off" spellCheck={false} disabled={!running} value={value}
        onChange={event => { setValue(event.target.value); setHistoryIndex(history.length); draft.current = event.target.value; }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            if (historyIndex === history.length) draft.current = value;
            const next = Math.max(0, Math.min(history.length, historyIndex + (event.key === "ArrowUp" ? -1 : 1)));
            setHistoryIndex(next); setValue(next === history.length ? draft.current : history[next] ?? "");
          } else if (event.key === "Enter" && threadId !== null && running) {
            event.preventDefault();
            const line = value;
            if (line.trim() === "") return;
            setValue(""); draft.current = ""; setHistory([...history, line]); setHistoryIndex(history.length + 1);
            void window.omo.terminalWrite(threadId, line).catch(error => {
              if (panelRef.current?.dataset.threadId !== threadId) return;
              setSession(current => ({ ...current, output: [...current.output, { threadId, stream: "system" as const, text: `${error instanceof Error ? error.message : String(error)}\n` }].slice(-2000) }));
            });
          }
        }} /></div>
      {threadId !== null && !running && !opening && <p className={css.hint}>{t("terminal.stopped")}</p>}
      <p className={css.hint}>{t("terminal.hint")}</p>
    </footer>
  </aside>;
}
