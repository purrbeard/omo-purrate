/**
 * Viewport fit for bottom-anchored overlays (the slash menu): the element's bottom edge is laid out
 * independent of its height, so it grows upward and only the top edge can collide with the viewport.
 */
import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

/** Safe distance kept between the overlay and the viewport top edge; the frame's overlay inset widens it. */
const MARGIN = 12

/**
 * Resolve the top margin an overlay keeps from the viewport edge.
 * @param min - the overlay's own viewport margin in px, used as the floor.
 * @returns the larger of `min` and the frame clearance plus 20px; fullscreen keeps only the 20px gap.
 */
function overlayTopMargin(min: number): number {
  const root = document.documentElement
  const clearance = Number.parseFloat(getComputedStyle(root).getPropertyValue('--dsh-frame-top-clearance'))
  if (Number.isNaN(clearance)) return min
  return Math.max(min, (root.hasAttribute('data-fullscreen') ? 0 : clearance) + 20)
}

/**
 * Clamp a bottom-anchored overlay's max-height to the viewport.
 * @param ref - the overlay element; a null current (overlay closed) skips measuring.
 * @param cap - design max-height in px (the clamp never exceeds it).
 * @param signal - re-measure trigger: pass the overlay's render state so anchor moves re-fit;
 *   resize/scroll re-fit while mounted.
 * @param margin - viewport top margin floor in px; callers under fixed chrome raise it past that chrome.
 * @returns the max-height to apply inline, in px.
 */
export function useAnchoredMaxHeight(ref: RefObject<HTMLElement | null>, cap: number, signal: unknown, margin: number = MARGIN): number {
  const [maxHeight, setMaxHeight] = useState(cap)
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const fit = () => {
      setMaxHeight(Math.min(cap, Math.max(0, el.getBoundingClientRect().bottom - overlayTopMargin(margin))))
    }
    fit()
    window.addEventListener('resize', fit)
    window.addEventListener('scroll', fit, true)
    return () => {
      window.removeEventListener('resize', fit)
      window.removeEventListener('scroll', fit, true)
    }
  }, [ref, cap, signal, margin])
  return maxHeight
}
