// StateDot: a status mark beside text. Solid states keep their layout slot and paint
// one round core in the state color; `ongoing` is a rotating ring whose animations
// are pinned to document time zero so every visible loader turns in step.

import clsx from 'clsx'
import './StateDot.css'

/** Green done / amber attention / grey loading / red error / neutral idle. */
export type StateDotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle'

export type StateDotProps = {
  state: StateDotState
  /** Outer diameter in px; defaults to 14 for ongoing and 10 for solid states. */
  size?: number | undefined
  /** Layout placement only. */
  className?: string | undefined
}

const tone: Record<Exclude<StateDotState, 'ongoing'>, string> = {
  done: 'text-success',
  warning: 'text-warning',
  error: 'text-destructive-foreground',
  idle: 'text-muted-foreground',
}

const stroke = 'fill-none stroke-current [stroke-linecap:round] [stroke-width:2]'

/**
 * A CSS animation starts when its element is inserted, so loaders mounted at different
 * moments would rotate out of phase; one shared start time keeps them in step.
 * @param element - the mounted spinner, or null on unmount.
 */
function syncSpinner(element: SVGSVGElement | null): void {
  if (element === null) return
  // jsdom implements no Web Animations despite lib.dom's non-optional typing.
  const spinner = element as { getAnimations?: SVGSVGElement['getAnimations'] }
  for (const animation of spinner.getAnimations?.({ subtree: true }) ?? []) animation.startTime = 0
}

/**
 * Render a state dot.
 * @param props.state - which state to show.
 * @param props.size - outer diameter in px.
 * @returns the aria-hidden mark; pair it with text for assistive technology.
 */
export function StateDot({ state, size, className }: StateDotProps) {
  const edge = size ?? (state === 'ongoing' ? 14 : 10)
  if (state === 'ongoing') {
    return (
      <svg
        ref={syncSpinner}
        className={clsx('flex-none text-muted-foreground', className)}
        data-state="ongoing"
        width={edge}
        height={edge}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <g className="origin-center animate-[omo-state-dot-spin_1.5s_linear_infinite] motion-reduce:animate-none">
          <circle className={clsx(stroke, 'opacity-25')} cx="12" cy="12" r="9.5" />
          <circle
            className={clsx(
              stroke,
              '[stroke-dasharray:12_150] animate-[omo-state-dot-dash_1.5s_ease-in-out_infinite]',
              'motion-reduce:animate-none motion-reduce:[stroke-dasharray:18_150] motion-reduce:[stroke-dashoffset:-3]',
            )}
            cx="12"
            cy="12"
            r="9.5"
          />
        </g>
      </svg>
    )
  }
  return (
    <span
      // No position of its own, so a caller may place the dot absolutely.
      className={clsx('inline-grid flex-none place-items-center', tone[state], className)}
      data-state={state}
      style={{ width: edge, height: edge }}
      aria-hidden="true"
    >
      {/* 50%, not rounded-full: an infinite radius squares off under a scaled canvas (WorkflowGraph zoom). */}
      <span className="size-[60%] rounded-[50%] bg-current" />
    </span>
  )
}
