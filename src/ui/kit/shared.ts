// Shared helpers for the kit primitives: className merging that preserves Base UI's
// state-callback form, the neutral focus ring, and the visible-label type contract.

import type { ReactElement } from 'react'
import clsx from 'clsx'

/** A Base UI className prop: a string or a callback that receives the part's state. */
export type StateClassName<State> = string | ((state: State) => string | undefined) | undefined

/**
 * Prepend kit classes to a caller className without losing the callback form.
 * @param base - the kit's utility classes for the part.
 * @param className - the caller's string or state callback.
 * @returns a string, or a state callback when the caller passed one.
 */
export function mergeClassName<State>(
  base: string,
  className: StateClassName<State>,
): string | ((state: State) => string) {
  if (typeof className === 'function') return (state: State) => clsx(base, className(state))
  return clsx(base, className)
}

/**
 * Neutral keyboard focus ring. Uses the ring token, never the primary accent, and
 * resets the UA outline because the app runs without Tailwind preflight.
 */
export const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

/**
 * Visible text for destructive and error surfaces. Limited to string | number
 * because ReactNode admits empty fragments, arrays, null and booleans, so those
 * surfaces cannot ship with an icon and color alone.
 */
export type VisibleLabel = string | number

/** A required icon element; ReactNode would admit null/false and render nothing. */
export type RequiredIcon = ReactElement
