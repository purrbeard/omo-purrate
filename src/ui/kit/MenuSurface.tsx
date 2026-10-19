// MenuSurface: the popover card behind the composer's anchored pickers (model, permission,
// reasoning effort, slash menu). The pickers own placement, focus and keyboard handling; this
// part owns only the material. MenuGroup is a named section of menu rows with a sticky heading;
// src/ui/lib/sticky-menu-groups.ts marks a heading `data-stuck` while it covers scrolled rows.

import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'
import clsx from 'clsx'

export type MenuSurfaceProps = ComponentPropsWithRef<'div'>

const surfaceClass =
  'relative isolate box-border rounded-xl border border-solid border-border bg-popover text-popover-foreground shadow-lg'

/**
 * Render the menu card. Caller classes are appended (not merged), so a caller that changes a
 * surface property (position, radius, padding) marks that utility important.
 * @returns a div; native div props and the ref pass through.
 */
export function MenuSurface({ className, ...props }: MenuSurfaceProps) {
  return <div {...props} className={clsx(surfaceClass, className)} />
}

export type MenuGroupProps = {
  /** Caller-localized group heading. */
  label: string
  children?: ReactNode
}

/**
 * Render a named group of menu rows: a sticky heading that names the section, plus an
 * invisible start sentinel observeStickyMenuGroups uses to tell when the heading is stuck.
 * Render groups as direct children of one unpadded scroll container.
 * @returns a `role="group"` section labelled by its heading.
 */
export function MenuGroup({ label, children }: MenuGroupProps) {
  const headingId = useId()
  return (
    <section role="group" aria-labelledby={headingId} data-menu-group="" className="relative mt-[3px] first:mt-0">
      <span aria-hidden="true" data-menu-group-start="" className="pointer-events-none absolute top-0 left-0 size-px opacity-0" />
      <div
        id={headingId}
        data-menu-group-heading=""
        className="sticky top-0 z-1 rounded-md px-[7px] pt-1 pb-0.5 text-[11px] font-medium leading-4 text-muted-foreground data-stuck:bg-popover"
      >
        {label}
      </div>
      {children}
    </section>
  )
}
