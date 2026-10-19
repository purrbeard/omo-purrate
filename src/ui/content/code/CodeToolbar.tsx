// CodeToolbar: the language label and the wrap/copy icon actions shared by code cards
// (CodeBlock, DiffBlock). Labels come from the owner's locale.

import clsx from 'clsx'
import { Check, Copy, MoveHorizontal, WrapText } from 'lucide-react'
import type { ReactElement } from 'react'
import { Tooltip } from '../../kit'
import { supportsHighlighting } from './highlight'

/** Localized language fallback and wrapping actions supplied by the card owner. */
export interface CodeToolbarLabels {
  /** Title for an absent or unsupported language. */
  codeLabel: string
  /** Action that enables wrapping. */
  wrapLabel: string
  /** Action that preserves source columns with horizontal scrolling. */
  unwrapLabel: string
}

const action = clsx(
  'm-0 inline-flex size-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0',
  'text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground motion-reduce:transition-none',
  'outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5',
)

function WithTooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Content side="top">{label}</Tooltip.Content>
    </Tooltip.Root>
  )
}

/**
 * Render the code-card header.
 * @param props - language hint, localized labels, current state and card-owned actions.
 * @returns the header row (data-code-block-banner).
 */
export function CodeToolbar({ lang, labels, copyLabel, copiedLabel, copied, wrapped, onCopy, onWrap }: {
  lang?: string | undefined
  labels: CodeToolbarLabels
  copyLabel: string
  copiedLabel: string
  copied: boolean
  wrapped: boolean
  onCopy: () => void
  onWrap: () => void
}) {
  const wrapLabel = wrapped ? labels.unwrapLabel : labels.wrapLabel
  const clipboardLabel = copied ? copiedLabel : copyLabel
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-t-[inherit] bg-message-code pt-2.5 pr-[18px] pb-2 pl-[22px] text-[11px] leading-[18px] text-muted-foreground"
      data-code-block-banner
    >
      <span className="min-w-0 flex-none font-mono">{supportsHighlighting(lang) ? lang : labels.codeLabel}</span>
      <div className="flex flex-none items-center gap-1">
        <WithTooltip label={wrapLabel}>
          <button type="button" className={action} aria-label={labels.wrapLabel} aria-pressed={wrapped} onClick={onWrap}>
            {wrapped ? <MoveHorizontal aria-hidden /> : <WrapText aria-hidden />}
          </button>
        </WithTooltip>
        <WithTooltip label={clipboardLabel}>
          <button type="button" className={action} aria-label={clipboardLabel} onClick={onCopy}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          </button>
        </WithTooltip>
      </div>
    </div>
  )
}
