// Menu: styled Base UI Menu parts. Import as a namespace. `Root`, `Trigger`, `Portal`
// and `Group` are Base UI's own parts (style Trigger through `render`); `Content`
// composes Portal + Positioner + Popup. A destructive Item requires an icon and a
// visible text label.

import type { ReactNode } from 'react'
import { Menu as BaseMenu } from '@base-ui/react/menu'
import clsx from 'clsx'
import { mergeClassName, type RequiredIcon, type VisibleLabel } from './shared'

export const Root = BaseMenu.Root
export const Trigger = BaseMenu.Trigger
export const Portal = BaseMenu.Portal
export const Group = BaseMenu.Group

export type RootProps = BaseMenu.Root.Props
export type TriggerProps = BaseMenu.Trigger.Props
export type PositionerProps = BaseMenu.Positioner.Props
export type PopupProps = BaseMenu.Popup.Props
export type GroupLabelProps = BaseMenu.GroupLabel.Props
export type SeparatorProps = BaseMenu.Separator.Props

const positionerClass = 'z-50 outline-none'

const popupClass = clsx(
  'box-border max-h-(--available-height) min-w-44 overflow-y-auto origin-(--transform-origin)',
  'rounded-lg border border-solid border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none',
  'transition-[opacity,scale] duration-100 ease-out motion-reduce:transition-none',
  'data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0',
)

const itemBase = clsx(
  'box-border flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm leading-5 outline-none',
  'data-disabled:pointer-events-none data-disabled:opacity-50',
  '[&_svg]:size-4 [&_svg]:shrink-0',
)

const itemTone = {
  default: 'text-popover-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground',
  destructive: 'text-destructive-foreground data-highlighted:bg-destructive data-highlighted:text-destructive-foreground',
} as const

/** Anchors the popup to the trigger; defaults to a 6px side offset. */
export function Positioner({ className, sideOffset = 6, ...props }: PositionerProps) {
  return <BaseMenu.Positioner {...props} sideOffset={sideOffset} className={mergeClassName(positionerClass, className)} />
}

/** The menu surface; render inside Positioner (or use Content). */
export function Popup({ className, ...props }: PopupProps) {
  return <BaseMenu.Popup {...props} className={mergeClassName(popupClass, className)} />
}

export type ContentProps = PopupProps &
  Pick<PositionerProps, 'side' | 'align' | 'sideOffset' | 'alignOffset' | 'collisionPadding'>

/**
 * Portal + Positioner + Popup in one part.
 * @param props.side / align / sideOffset / alignOffset / collisionPadding - forwarded to the Positioner.
 * @returns the portalled popup; Popup props pass through.
 */
export function Content({ side, align = 'start', sideOffset, alignOffset, collisionPadding, ...props }: ContentProps) {
  return (
    <BaseMenu.Portal>
      <Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
      >
        <Popup {...props} />
      </Positioner>
    </BaseMenu.Portal>
  )
}

type DefaultItemProps = {
  variant?: 'default' | undefined
  /** Optional leading icon. */
  icon?: ReactNode
  children?: ReactNode
}

type DestructiveItemProps = {
  variant: 'destructive'
  /** Required: destructive items are never signalled by color alone. */
  icon: RequiredIcon
  /** Required visible text label. */
  children: VisibleLabel
}

export type ItemProps = Omit<BaseMenu.Item.Props, 'children'> & (DefaultItemProps | DestructiveItemProps)

/**
 * A menu item with an optional leading icon.
 * @param props.variant - 'default' or 'destructive' (destructive requires icon and text).
 * @returns the Base UI Menu.Item; its props pass through.
 */
export function Item({ variant = 'default', icon, className, children, ...props }: ItemProps) {
  return (
    <BaseMenu.Item {...props} className={mergeClassName(clsx(itemBase, itemTone[variant]), className)}>
      {icon}
      {children}
    </BaseMenu.Item>
  )
}

/** Small heading for a Group. */
export function GroupLabel({ className, ...props }: GroupLabelProps) {
  return (
    <BaseMenu.GroupLabel
      {...props}
      className={mergeClassName('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)}
    />
  )
}

/** Hairline divider between item groups. */
export function Separator({ className, ...props }: SeparatorProps) {
  return <BaseMenu.Separator {...props} className={mergeClassName('-mx-1 my-1 h-px bg-border', className)} />
}
