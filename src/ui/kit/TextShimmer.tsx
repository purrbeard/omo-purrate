// TextShimmer: one highlight sweeping across a row's text while its operation runs.
// The real text stays selectable and accessible; the moving highlight is an inert,
// clipped decorative copy. Nested instances share the outermost row's activity.

import { createContext, memo, useContext, type ReactNode } from 'react'
import clsx from 'clsx'
import './TextShimmer.css'

const DecorativeCopy = createContext<boolean | undefined>(undefined)

export interface TextShimmerProps {
  /** Text, or presentational children with text in nested TextShimmer instances. No effects or element ids. */
  children: ReactNode
  /** Whether to animate; nested instances share the containing row's activity. */
  active?: boolean | undefined
  className?: string | undefined
  /** Layout class applied equally to the base and decorative content. */
  contentClassName?: string | undefined
}

const content = 'flex min-w-0 items-center'

/** One frame of motion: the sweep and the copy inside it move in opposite directions so glyphs stay put. */
const motion = 'animate-[var(--shimmer-motion)] motion-reduce:animate-none'

function TextContent({ children, className }: Pick<TextShimmerProps, 'children' | 'className'>) {
  const decorative = useContext(DecorativeCopy)
  const generated = decorative === true && typeof children === 'string'
  return (
    <span
      className={clsx('text-inherit data-shimmer-text:after:content-[attr(data-shimmer-text)]', className)}
      data-shimmer-text={generated ? children : undefined}
    >
      {generated ? null : children}
    </span>
  )
}

/**
 * Render text with one shared highlight. Keep icons outside; mark decorative separators
 * with data-shimmer-decoration so their fill follows the highlight.
 * @param props - text, running state and owner styling.
 * @returns the retained text and, while active, its decorative highlight.
 */
export const TextShimmer = memo(function TextShimmer({ children, active = false, className, contentClassName }: TextShimmerProps) {
  const decorative = useContext(DecorativeCopy)
  if (decorative !== undefined) return <TextContent className={className}>{children}</TextContent>
  const body = typeof children === 'string' ? <TextContent>{children}</TextContent> : children
  return (
    <span
      className={clsx('relative inline-grid w-max min-w-0 max-w-full align-top text-inherit', className)}
      data-shimmer={active || undefined}
    >
      <DecorativeCopy.Provider value={false}>
        <span className={clsx(content, contentClassName)}>{body}</span>
      </DecorativeCopy.Provider>
      {active && (
        <span
          className="pointer-events-none absolute inset-0 overflow-clip select-none motion-reduce:hidden"
          aria-hidden="true"
          inert
        >
          <span
            className={clsx(
              'absolute inset-0 [transform:translateX(-100%)] overflow-hidden text-foreground [--shimmer-motion:omo-shimmer-sweep_1.5s_steps(48,end)_0.3s_infinite]',
              '[mask-image:linear-gradient(105deg,transparent_0%,black_40%_60%,transparent_100%)]',
              '[&_*]:text-inherit! [&_[data-shimmer-decoration]]:bg-current',
              motion,
            )}
          >
            <DecorativeCopy.Provider value>
              <span
                className={clsx(
                  content,
                  'size-full [transform:translateX(100%)] [--shimmer-motion:omo-shimmer-highlight_1.5s_steps(48,end)_0.3s_infinite]',
                  motion,
                  contentClassName,
                )}
              >
                {body}
              </span>
            </DecorativeCopy.Provider>
          </span>
        </span>
      )}
    </span>
  )
})
