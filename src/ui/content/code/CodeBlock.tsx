// CodeBlock: a highlighted code card with the shared toolbar. Settled code renders shiki's
// HTML; a growing (streaming) fence re-tokenizes only appended text through a
// per-instance session and keeps completed line groups untouched.

import { Fragment, useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { writeClipboard } from '../clipboard'
import { CodeToolbar, type CodeToolbarLabels } from './CodeToolbar'
import { StreamingHighlightSession, grammarLoadCount, highlightToHtml, subscribeGrammarLoaded } from './highlight'
import type { HighlightSpan, StreamingHighlightFrame } from './highlight'
import { useViewportHighlighting } from './use-viewport-highlighting'
import './code-block.css'

export interface CodeBlockProps {
  /** The source text, rendered verbatim (one trailing newline trimmed for display). */
  code: string
  /** Grammar hint (markdown fence info string or a fixed caller id); unknown = plain. */
  lang?: string | undefined
  /**
   * The code is still growing (a streaming markdown fence). The caller keeps the instance
   * stable across growth (a stream-stable React key); an unchanged streamed fence also
   * keeps its tree when it settles.
   */
  streaming?: boolean | undefined
  /** Placement class; set `--code-block-font` here to change the code size. */
  className?: string | undefined
  copyLabel: string
  copiedLabel: string
  toolbarLabels: CodeToolbarLabels
}

/** The `pre` attributes shiki's HTML arm emits, mirrored so both arms produce interchangeable trees. */
const SHIKI_PRE_PROPS = {
  className: 'shiki css-variables',
  style: { backgroundColor: 'var(--shiki-background)', color: 'var(--shiki-foreground)' },
  tabIndex: 0,
} as const

/** Completed-line group size; React reconciles groups while the DOM stays line-for-line identical. */
const STREAMING_LINE_GROUP_SIZE = 32

function renderLine(line: readonly HighlightSpan[], index: number): ReactNode {
  return (
    <Fragment key={index}>
      {index > 0 && '\n'}
      <span className="line">
        {line.map((span, spanIndex) => <span key={spanIndex} style={span.style}>{span.text}</span>)}
      </span>
    </Fragment>
  )
}

/**
 * Render a code card.
 * @param props - see {@link CodeBlockProps}.
 * @returns the card (`md-code-block`, data-code-block).
 */
export function CodeBlock({ code, lang, streaming, className, copyLabel, copiedLabel, toolbarLabels }: CodeBlockProps) {
  const trimmed = code.endsWith('\n') ? code.slice(0, -1) : code
  const rootRef = useRef<HTMLDivElement>(null)
  const highlighting = useViewportHighlighting(rootRef, lang)
  // Re-render when a lazy grammar finishes loading; only the snapshot's change matters.
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  const sessionRef = useRef<StreamingHighlightSession | null>(null)
  const lineCacheRef = useRef<{
    code: string
    lang: string | undefined
    generation: number
    frame: StreamingHighlightFrame
    groups: ReactNode[]
    pending: ReactNode[]
    nextLine: number
    body: ReactNode
  } | null>(null)
  const settledRef = useRef(false)
  const streamedBody = useMemo(() => {
    if (!highlighting) {
      sessionRef.current = null
      lineCacheRef.current = null
      settledRef.current = false
      return undefined
    }
    if (streaming !== true) {
      const previous = lineCacheRef.current
      if (previous !== null && previous.code === trimmed && previous.lang === lang) {
        settledRef.current = true
        return previous.body
      }
      sessionRef.current = null
      lineCacheRef.current = null
      settledRef.current = true
      return undefined
    }
    if (settledRef.current) {
      sessionRef.current = null
      lineCacheRef.current = null
      settledRef.current = false
    }
    sessionRef.current ??= new StreamingHighlightSession()
    const frame = sessionRef.current.updateFrame(trimmed, lang)
    if (frame === undefined) {
      lineCacheRef.current = null
      return undefined
    }
    const previous = lineCacheRef.current
    if (previous?.frame === frame && previous.code === trimmed && previous.lang === lang) return previous.body
    const sameGeneration = previous?.generation === frame.generation
    const groups = sameGeneration ? [...previous.groups] : []
    let pending = sameGeneration ? [...previous.pending] : []
    let nextLine = sameGeneration ? previous.nextLine : 0
    for (const line of frame.appended) {
      pending.push(renderLine(line, nextLine))
      nextLine += 1
      if (pending.length !== STREAMING_LINE_GROUP_SIZE) continue
      const start = nextLine - pending.length
      groups.push(<Fragment key={start}>{pending}</Fragment>)
      pending = []
    }
    const tail = frame.tail.map((line, index) => renderLine(line, nextLine + index))
    const tailGroup = <Fragment key={nextLine - pending.length}>{[...pending, ...tail]}</Fragment>
    const body = <pre {...SHIKI_PRE_PROPS}><code>{groups}{tailGroup}</code></pre>
    lineCacheRef.current = { code: trimmed, lang, generation: frame.generation, frame, groups, pending, nextLine, body }
    return body
    // `loaded` re-runs the memo when a lazy grammar arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, highlighting, trimmed, lang, loaded])
  const html = useMemo(
    () => (highlighting && streaming !== true && streamedBody === undefined ? highlightToHtml(trimmed, lang) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streaming, highlighting, streamedBody, trimmed, lang, loaded],
  )
  const [copied, setCopied] = useState(false)
  const [wrapped, setWrapped] = useState(true)

  const onCopy = useCallback(() => {
    if (copied) return
    const text = rootRef.current?.querySelector('pre')?.textContent ?? trimmed
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, trimmed])
  const onWrap = useCallback(() => { setWrapped(value => !value) }, [])

  // shiki's HTML is a static span tree generated from `code` (no user HTML passes through).
  const body = streamedBody !== undefined
    ? streamedBody
    : html === undefined
      ? <pre><code>{trimmed}</code></pre>
      : <div dangerouslySetInnerHTML={{ __html: html }} />

  return (
    <div
      ref={rootRef}
      className={clsx('md-code-block relative my-4 rounded-[var(--dsw-radius-lg)] bg-message-code text-message-code-foreground not-last:mb-[11px]', className)}
      data-code-block
      data-code-wrap={wrapped}
    >
      <div className="sticky top-0 z-[6] rounded-t-[var(--dsw-radius-lg)] bg-background">
        <CodeToolbar
          lang={lang}
          labels={toolbarLabels}
          copyLabel={copyLabel}
          copiedLabel={copiedLabel}
          copied={copied}
          wrapped={wrapped}
          onCopy={onCopy}
          onWrap={onWrap}
        />
      </div>
      <div className="contents" data-code-block-content>{body}</div>
    </div>
  )
}
