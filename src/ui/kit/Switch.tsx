// Switch: Base UI Switch with styled Root/Thumb parts and a labelled composite.
// The checked track uses the neutral foreground token, never the primary accent.

import type { ReactNode } from 'react'
import { Switch as BaseSwitch } from '@base-ui/react/switch'
import clsx from 'clsx'
import { focusRing, mergeClassName } from './shared'

const rootClass = clsx(
  'relative box-border inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5',
  'border border-solid border-border bg-muted transition-colors duration-150 motion-reduce:transition-none',
  focusRing,
  'data-checked:border-foreground data-checked:bg-foreground',
  'data-disabled:cursor-not-allowed data-disabled:opacity-50',
)

const thumbClass = clsx(
  'pointer-events-none block size-3.5 rounded-full bg-muted-foreground shadow-sm',
  'transition-[translate,background-color] duration-150 ease-out motion-reduce:transition-none',
  'data-checked:translate-x-4 data-checked:bg-background',
)

/** Styled Base UI Switch.Root (track). Props and className callback match Base UI. */
export function SwitchRoot({ className, ...props }: BaseSwitch.Root.Props) {
  return <BaseSwitch.Root {...props} className={mergeClassName(rootClass, className)} />
}

/** Styled Base UI Switch.Thumb. */
export function SwitchThumb({ className, ...props }: BaseSwitch.Thumb.Props) {
  return <BaseSwitch.Thumb {...props} className={mergeClassName(thumbClass, className)} />
}

export type SwitchProps = Omit<BaseSwitch.Root.Props, 'children' | 'aria-label' | 'aria-labelledby'> & {
  /** Required accessible name, rendered as the wrapping label's text. */
  label: ReactNode
  /** Keep the label for assistive tech only (visually hidden). */
  hideLabel?: boolean | undefined
  /** Extra class for the wrapping <label>. */
  labelClassName?: string | undefined
}

/**
 * Render a labelled switch: <label> wrapping the styled Root and its text.
 * @param props.label - required accessible name.
 * @param props.hideLabel - visually hide the text while keeping the name.
 * @returns the label element; Base UI Switch.Root props pass through to the track.
 */
export function Switch({ label, hideLabel = false, labelClassName, ...props }: SwitchProps) {
  return (
    <label
      className={clsx(
        'inline-flex cursor-pointer select-none items-center gap-2 text-sm text-foreground',
        'has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-50',
        labelClassName,
      )}
    >
      <SwitchRoot {...props}>
        <SwitchThumb />
      </SwitchRoot>
      <span className={hideLabel ? 'sr-only' : undefined}>{label}</span>
    </label>
  )
}
