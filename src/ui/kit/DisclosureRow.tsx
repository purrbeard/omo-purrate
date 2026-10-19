// DisclosureRow: the shared 24px process row (reasoning, tool calls): a 16px leading
// icon, a 13px title and optional inline summary, and controlled expanded content.
// Sizes follow the user's content font size through --dsh-content-font-*.

import { memo, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { TextShimmer } from './TextShimmer'

export interface DisclosureRowProps {
  icon: ReactNode
  title: string
  open: boolean
  expandable: boolean
  onToggle: () => void
  /** Animate the whole header while its owning operation is running. */
  running?: boolean | undefined
  /** Makes the whole title row the disclosure target. */
  expandOnRowClick?: boolean | undefined
  /** Replaces the collapsed icon with a chevron while the row is hovered. */
  previewChevron?: boolean | undefined
  /** Keeps `collapsedContent` inline while open. */
  keepContentWhenOpen?: boolean | undefined
  collapsedContent?: ReactNode
  children?: ReactNode
  className?: string | undefined
  rowClassName?: string | undefined
  /** Sizing class for the header text area, beside the leading icon. */
  contentClassName?: string | undefined
  /** Layout class shared by the header text and its decorative copy. */
  contentLayoutClassName?: string | undefined
  leadingClassName?: string | undefined
  chevronClassName?: string | undefined
  titleClassName?: string | undefined
}

const row = clsx(
  'group/disclosure relative flex h-[calc(24px+var(--dsh-content-font-delta,0px))] min-w-0 items-center overflow-hidden',
  'text-muted-foreground transition-colors duration-100 hover:text-foreground motion-reduce:transition-none',
  'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-expandable:cursor-pointer',
)

const leading = clsx(
  'relative m-0 mr-1.5 inline-flex size-[calc(16px+var(--dsh-content-font-delta,0px))] flex-none items-center justify-center',
  'border-0 bg-transparent p-0 text-inherit',
  // Glyphs render at 14px inside the 16px box; a StateDot (svg[data-state]) keeps its own size.
  '[&_svg:not([data-state])]:size-[calc(14px+var(--dsh-content-font-delta,0px))]',
)

const fade = 'transition-opacity duration-100 motion-reduce:transition-none'

/**
 * Render one disclosure header and its controlled expanded content. Shallow prop
 * comparison needs stable callbacks and React nodes to skip unchanged renders.
 * @param props - visual content, controlled state and interaction policy.
 * @returns the disclosure row.
 */
export const DisclosureRow = memo(function DisclosureRow({
  icon,
  title,
  open,
  expandable,
  onToggle,
  running = false,
  expandOnRowClick = false,
  previewChevron = expandable,
  keepContentWhenOpen = false,
  collapsedContent,
  children,
  className,
  rowClassName,
  contentClassName,
  contentLayoutClassName,
  leadingClassName,
  chevronClassName,
  titleClassName,
}: DisclosureRowProps) {
  const rowExpands = expandable && expandOnRowClick
  const toggleFromLeading = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onToggle()
  }
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rowExpands || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onToggle()
  }
  const collapsedLeading = previewChevron ? (
    <>
      <span className={clsx('inline-flex opacity-100 group-hover/disclosure:opacity-0', fade)}>{icon}</span>
      <ChevronDown
        className={clsx(chevronClassName, 'absolute inset-0 m-auto opacity-0 group-hover/disclosure:opacity-100', fade)}
        aria-hidden
      />
    </>
  ) : (
    icon
  )
  const leadingContent = open ? <ChevronUp className={chevronClassName} aria-hidden /> : collapsedLeading

  return (
    <div className={clsx('flex w-full min-w-0 flex-col', className)} data-open={open || undefined}>
      <div
        className={clsx(row, rowClassName)}
        data-disclosure-row
        data-expandable={rowExpands || undefined}
        role={rowExpands ? 'button' : undefined}
        tabIndex={rowExpands ? 0 : undefined}
        aria-expanded={rowExpands ? open : undefined}
        onClick={rowExpands ? onToggle : undefined}
        onKeyDown={rowExpands ? toggleFromKeyboard : undefined}
      >
        {expandable && !rowExpands ? (
          <button
            type="button"
            className={clsx(leading, 'cursor-pointer', leadingClassName)}
            aria-label={title}
            aria-expanded={open}
            onClick={toggleFromLeading}
          >
            {leadingContent}
          </button>
        ) : (
          <span className={clsx(leading, leadingClassName)}>{leadingContent}</span>
        )}
        <TextShimmer active={running} className={contentClassName} contentClassName={contentLayoutClassName}>
          <TextShimmer
            className={clsx(
              'flex-none text-[length:var(--dsh-content-font-size-secondary,13px)] leading-[calc(24px+var(--dsh-content-font-delta,0px))]',
              titleClassName,
            )}
          >
            {title}
          </TextShimmer>
          {(keepContentWhenOpen || !open) && collapsedContent}
        </TextShimmer>
      </div>
      {open && children}
    </div>
  )
})
