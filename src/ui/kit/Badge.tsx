// Badge: small inline status label. A destructive badge requires an icon and a
// visible text label so the state is never conveyed by color alone.

import type { ComponentPropsWithRef, ReactNode } from 'react'
import clsx from 'clsx'
import type { RequiredIcon, VisibleLabel } from './shared'

export type BadgeVariant = 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'

type SpanProps = Omit<ComponentPropsWithRef<'span'>, 'children'>

type StatusBadgeProps = {
  variant?: Exclude<BadgeVariant, 'destructive'> | undefined
  /** Optional leading icon, sized to 12px. */
  icon?: ReactNode
  children?: ReactNode
}

type DestructiveBadgeProps = {
  variant: 'destructive'
  /** Required: error state is never signalled by color alone. */
  icon: RequiredIcon
  /** Required visible text label. */
  children: VisibleLabel
}

export type BadgeProps = SpanProps & (StatusBadgeProps | DestructiveBadgeProps)

const base = clsx(
  'box-border inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-solid px-2 py-0.5',
  'text-xs font-medium leading-4',
  '[&_svg]:size-3 [&_svg]:shrink-0',
)

const variants: Record<BadgeVariant, string> = {
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  outline: 'border-border bg-transparent text-foreground',
  success: 'border-success/40 bg-success/15 text-foreground [&_svg]:text-success',
  warning: 'border-warning/40 bg-warning/15 text-foreground [&_svg]:text-warning',
  destructive: 'border-transparent bg-destructive text-destructive-foreground',
}

/**
 * Render a badge.
 * @param props.variant - visual tone (default 'secondary'); 'destructive' requires icon and text.
 * @param props.icon - leading icon.
 * @returns a <span>; native span props pass through.
 */
export function Badge({ variant = 'secondary', icon, className, children, ...rest }: BadgeProps) {
  return (
    <span {...rest} className={clsx(base, variants[variant], className)}>
      {icon}
      {children}
    </span>
  )
}
