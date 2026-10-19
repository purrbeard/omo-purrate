import { useCallback, useMemo, useState } from 'react'
import clsx from 'clsx'
import { StateDot, type StateDotState } from '../kit'
import { parseAnsiLines, type AnsiLine } from './ansi'
import { writeClipboard } from './clipboard'
import { headTailCap } from './head-tail-cap'

/** Output lines shown before the height cap collapses the middle. */
export const DEFAULT_TERMINAL_MAX_LINES = 16

/** Localized display copy for the terminal surface. */
export interface TerminalBlockLabels {
  /** Status pill text for a signal-terminated command. */
  signal: (signal: string) => string
  /** Status pill text for a non-zero exit code. */
  exitCode: (exitCode: number) => string
  /** Status pill text for a command that ended without an exit code: killed by a signal the view does not know, or never started. */
  noExitCode: string
  /** Run-state text while the command is still running. */
  running: string
  /** Run-state text for a signal or non-zero-exit settle. */
  failed: string
  /** Run-state text for a clean settle. */
  done: string
  /** Copy-button idle label. */
  copy: string
  /** Copy-button label during the post-copy confirmation window. */
  copied: string
  /** Placeholder when a settled command produced no visible output. */
  noOutput: string
  /** Collapse-toggle aria label while expanded. */
  collapseAria: string
  /** Collapse-toggle text while expanded. */
  collapse: string
  /** Expand-toggle aria label while capped, given the hidden line count. */
  expandAria: (hidden: number) => string
  /** Expand-toggle text while capped, given the hidden line count. */
  expand: (hidden: number) => string
}

export interface TerminalBlockProps {
  /** The command line, rendered verbatim after the prompt label. */
  command: string
  /** Working directory for the prompt label; absent renders a plain `$`. */
  cwd?: string | undefined
  /** Absolute home directory, so a cwd equal to it collapses to `~`; absent disables that collapse. */
  home?: string | undefined
  /** The command's output text; may contain ANSI escape sequences. */
  output?: string | undefined
  /** Settled exit code; a non-zero value renders the status pill, and null (settled without one) the no-exit-code pill. */
  exitCode?: number | null | undefined
  /** Settled terminating signal name; any value renders the status pill, taking precedence over the exit code. */
  signal?: string | undefined
  /**
   * The command is still running: with no `output` the block shows the prompt
   * line alone; with output it renders the live text under the running state.
   */
  running?: boolean | undefined
  /** Height cap in output lines before the middle collapses (default {@link DEFAULT_TERMINAL_MAX_LINES}); Infinity disables the cap. */
  maxLines?: number | undefined
  /**
   * Copy-control payload override; the control copies the raw output when
   * absent. Supplying it also keeps the control rendered before any output
   * exists — a command is copyable before it prints.
   */
  copyText?: string | undefined
  /**
   * Draw the run-state dot and its assistive label in the card gutter
   * (default true). Hosts whose surrounding row already carries the same
   * state omit both and reclaim the gutter via `--tb-gutter`.
   */
  runStateDot?: boolean | undefined
  /**
   * Extra class merged onto the wrapper (callers position; this component draws). Sizing
   * rebinds through custom properties: --tb-gutter (30px), --tb-font (code-block font),
   * --tb-line-height (22px) and --tb-output-max-height (none).
   */
  className?: string | undefined
  /** Localized display copy supplied by the owning render site. */
  labels: TerminalBlockLabels
}

/**
 * Prompt label for a working directory: `~` for the home directory itself,
 * otherwise the path's last segment (both separators accepted, trailing
 * separators ignored), falling back to the path itself when it has no
 * segment.
 * @param cwd - the working directory path.
 * @param home - absolute home directory, when the caller knows it.
 * @returns the prompt label.
 */
function promptLabel(cwd: string, home: string | undefined): string {
  const trimmed = cwd.replace(/[/\\]+$/, '')
  if (home !== undefined && trimmed === home.replace(/[/\\]+$/, '')) return '~'
  const segment = trimmed.split(/[/\\]/).pop()
  return segment === undefined || segment === '' ? cwd : segment
}

/**
 * Status pill text for a settled command, or undefined when the command
 * settled cleanly (exit 0, no signal) and needs no pill — the same
 * distinction the bash tool's own exit-status markers draw.
 * @param exitCode - settled exit code, when known; null when the command settled without one.
 * @param signal - settled terminating signal name, when known.
 * @param labels - display copy for the pill text.
 * @returns the pill text, or undefined for a clean exit.
 */
function statusText(
  exitCode: number | null | undefined,
  signal: string | undefined,
  labels: TerminalBlockLabels,
): string | undefined {
  if (signal !== undefined) return labels.signal(signal)
  if (exitCode === null) return labels.noExitCode
  if (exitCode !== undefined && exitCode !== 0) return labels.exitCode(exitCode)
  return undefined
}

/**
 * Run-state indicator for the command, shown at the head of the prompt line so
 * the card states whether the command is still running without the reader
 * having to infer it from the presence of output. Three of {@link StateDotState}'s
 * five states are reachable: the running chase (the same
 * indicator a running tool row's leading icon uses, so the row and its card
 * never disagree), green for a clean settle, red for a signal or a non-zero
 * exit — the same status distinction {@link statusText} draws for the pill. A
 * settled command whose exit status never reached the view counts as a clean
 * settle: the view says it finished and says nothing went wrong.
 * @param running - the command has not settled.
 * @param exitCode - settled exit code, when known; null when the command settled without one.
 * @param signal - settled terminating signal name, when known.
 * @param labels - display copy for the text label.
 * @returns the dot's state and its text label, since the dot is aria-hidden.
 */
function runState(
  running: boolean,
  exitCode: number | null | undefined,
  signal: string | undefined,
  labels: TerminalBlockLabels,
): { state: StateDotState; label: string } {
  if (running) return { state: 'ongoing', label: labels.running }
  if (statusText(exitCode, signal, labels) !== undefined) return { state: 'error', label: labels.failed }
  return { state: 'done', label: labels.done }
}

/** Scrollbars float 2px off the card edge and keep their travel out of the rounded corners. */
const SCROLLBAR = clsx(
  '[&::-webkit-scrollbar-thumb]:rounded-[var(--dsw-radius-sm)] [&::-webkit-scrollbar-thumb]:border-2',
  '[&::-webkit-scrollbar-thumb]:border-solid [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-clip-padding',
  '[&::-webkit-scrollbar-track]:m-1.5',
)

/**
 * The command banner spans the full card (pulled back across the gutter, then re-inset)
 * and scrolls a long multi-line command; a hairline divides it from a present body.
 */
const HEADER = clsx(
  '-ml-[var(--tb-gutter,30px)] flex max-h-[150px] items-start gap-3 overflow-y-auto rounded-t-[var(--dsw-radius-lg)]',
  'border-0 border-solid border-border py-[9px] pr-3.5 pl-[var(--tb-gutter,30px)] group-data-body/terminal:border-b-[0.5px]',
  SCROLLBAR,
)

/** Output lines keep terminal alignment (`pre`). */
const LINE = 'min-h-[var(--tb-line-height,22px)] whitespace-pre [overflow-wrap:anywhere]'

/**
 * Render one parsed output line. Runs without SGR state render as bare text,
 * so uncolored output carries no span wrappers.
 * @param line - the line's styled runs.
 * @returns the line's children.
 */
function renderLine(line: AnsiLine) {
  return line.map((span, index) => span.style === undefined
    ? span.text
    : <span key={index} style={span.style}>{span.text}</span>)
}

/**
 * Copy `text` to the clipboard with one-second success feedback.
 * @param text - the text to write on copy.
 * @returns the `copied` flag and the `onCopy` handler.
 */
function useCopyFeedback(text: string): { copied: boolean; onCopy: () => void } {
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, text])
  return { copied, onCopy }
}

/**
 * Render a shell command as a terminal surface.
 * @param props - see {@link TerminalBlockProps}.
 * @returns the terminal block element.
 */
export function TerminalBlock({
  command,
  cwd,
  home,
  output,
  exitCode,
  signal,
  running = false,
  maxLines = DEFAULT_TERMINAL_MAX_LINES,
  copyText,
  runStateDot = true,
  className,
  labels,
}: TerminalBlockProps) {
  const copy = labels
  const text = output ?? ''
  // A command's output ends with a newline; that terminator is not an extra
  // blank line to draw or to count against the height cap. The check runs on the
  // PARSED lines rather than on the raw text, because a reset after the final
  // newline (`line\n\x1b[0m`) leaves the string not ending in one while still
  // producing a last line with nothing visible in it. A genuinely blank final
  // line — the double newline — survives, since it has a real empty line before
  // the terminator. The copy control's payload is unaffected.
  const lines = useMemo(() => {
    const parsed = parseAnsiLines(text)
    const last = parsed[parsed.length - 1]
    const terminated = parsed.length > 1 && last !== undefined
      && last.every(span => span.text === '')
    return terminated ? parsed.slice(0, -1) : parsed
  }, [text])
  const [expanded, setExpanded] = useState(false)
  // The raw output (or the caller's override), never the rendered tree: the
  // prompt line and the status pill are chrome the user did not run.
  const { copied, onCopy } = useCopyFeedback(copyText ?? text)

  const onToggle = useCallback(() => { setExpanded(value => !value) }, [])

  const status = statusText(exitCode, signal, copy)
  const state = runState(running, exitCode, signal, copy)
  // A multi-line command gets one prompt row per line, so a two-command shell
  // snippet reads as the two commands it is instead of collapsing into one
  // ellipsized row. A trailing newline is a terminator, not an empty command.
  const commandLines = useMemo(() => {
    const body = command.endsWith('\n') ? command.slice(0, -1) : command
    return body.split('\n')
  }, [command])
  // Read from the parsed lines the card actually renders, not from the raw text:
  // output that is only escapes or control bytes (a lone reset, an OSC title, an
  // erase) survives `text.trim()` yet parses to nothing visible. Judging it on
  // the raw text would draw an output box of blank rows plus a copy control
  // for invisible bytes, and hide the placeholder that belongs there.
  const empty = lines.every(line => line.every(span => span.text.trim() === ''))
  const { hidden, capped, headLines, tailLines } = headTailCap(lines.length, maxLines, expanded)
  // A running command with nothing printed yet is banner-only; once it has
  // printed, the output streams in under the banner as it would in a terminal.
  const body = !running || !empty

  return (
    <div
      className={clsx(
        'group/terminal relative my-4 overflow-hidden rounded-[var(--dsw-radius-lg)] bg-message-code pl-[var(--tb-gutter,30px)] text-foreground',
        className,
      )}
      data-terminal=""
      data-running={running ? '' : undefined}
      data-body={body ? '' : undefined}
    >
      <div className={HEADER}>
        <div className="flex min-w-0 flex-1 flex-col [font:var(--tb-font,var(--dsw-font-markdown-code-block))]">
          {runStateDot && <span className="sr-only">{state.label}</span>}
          {commandLines.map((line, index) => (
            <div key={index} className="relative flex min-w-0 items-baseline gap-2 leading-[var(--tb-line-height,22px)]">
              {/* One dot for the card, on the first row: the exit status is the whole call's. */}
              {index === 0 && runStateDot && (
                <StateDot state={state.state} className="absolute top-1/2 left-[calc(-1*var(--tb-gutter,30px)+8px)] -translate-y-1/2" />
              )}
              {/* The cwd labels the call, so only its first row carries it; later rows keep a bare `$`. */}
              <span className="flex-none text-muted-foreground">
                {index > 0 || cwd === undefined ? '$' : promptLabel(cwd, home)}
              </span>
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre text-foreground [overflow-wrap:anywhere]">{line}</span>
            </div>
          ))}
        </div>
        {status !== undefined && (
          <span className="sticky top-0 inline-flex h-[var(--tb-line-height,22px)] flex-none items-center gap-1 rounded-full bg-popover px-2 text-xs leading-[18px] text-destructive-foreground">
            {status}
          </span>
        )}
        {(copyText !== undefined || (!running && !empty)) && (
          <button
            type="button"
            className="sticky top-0 m-0 flex-none cursor-pointer border-0 bg-message-code p-0 text-[13px] leading-[var(--tb-line-height,22px)] text-muted-foreground [font-family:var(--dsw-font-family)] hover:text-foreground"
            onClick={onCopy}
          >
            {copied ? copy.copied : copy.copy}
          </button>
        )}
      </div>
      {body && (empty
        ? <div className="py-3 pr-3.5 text-muted-foreground [font:var(--tb-font,var(--dsw-font-markdown-code-block))]">{copy.noOutput}</div>
        : (
          <div className={clsx('max-h-[var(--tb-output-max-height,none)] overflow-auto py-3 pr-3.5 [font:var(--tb-font,var(--dsw-font-markdown-code-block))]', SCROLLBAR)}>
            {(capped ? lines.slice(0, headLines) : lines).map((line, index) => (
              <div key={index} className={LINE}>{renderLine(line)}</div>
            ))}
            {hidden > 0 && (
              <button
                type="button"
                className="m-0 block w-full cursor-pointer border-0 bg-transparent p-0 text-left [font:inherit] text-muted-foreground hover:text-foreground"
                aria-expanded={expanded}
                aria-label={expanded ? copy.collapseAria : copy.expandAria(hidden)}
                onClick={onToggle}
              >
                {expanded ? copy.collapse : copy.expand(hidden)}
              </button>
            )}
            {capped && lines.slice(lines.length - tailLines).map((line, index) => (
              <div key={index} className={LINE}>{renderLine(line)}</div>
            ))}
          </div>
        ))}
    </div>
  )
}
