// Button: Base UI Button with token-backed variants. The props union makes a
// destructive button carry an icon and a visible text label, and an icon-sized
// button carry an accessible name.

import type { ReactNode } from 'react'
import { Button as BaseButton } from '@base-ui/react/button'
import clsx from 'clsx'
import { focusRing, mergeClassName, type RequiredIcon, type VisibleLabel } from './shared'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'destructive'
/** Variants allowed where no visible text label is guaranteed (icon-only controls). */
export type SafeButtonVariant = Exclude<ButtonVariant, 'destructive'>
export type ButtonSize = 'sm' | 'md' | 'icon'

type NativeButtonProps = Omit<BaseButton.Props, 'children'>

type TextButtonProps = {
  variant?: SafeButtonVariant | undefined
  size?: 'sm' | 'md' | undefined
  /** Optional leading icon, sized to 16px. */
  icon?: ReactNode
  children?: ReactNode
}

type DestructiveButtonProps = {
  variant: 'destructive'
  size?: 'sm' | 'md' | undefined
  /** Required: destructive actions are never signalled by color alone. */
  icon: RequiredIcon
  /** Required visible text label. */
  children: VisibleLabel
}

type IconSizedButtonProps = {
  variant?: SafeButtonVariant | undefined
  size: 'icon'
  icon?: never
  /** The icon itself. */
  children: ReactNode
  /** Required accessible name: the control has no visible text. */
  'aria-label': string
}

export type ButtonProps = NativeButtonProps & (TextButtonProps | DestructiveButtonProps | IconSizedButtonProps)

const base = clsx(
  'box-border m-0 inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap',
  'rounded-md border border-solid [font-family:inherit] font-medium leading-none no-underline',
  'transition-colors duration-150 motion-reduce:transition-none',
  focusRing,
  'disabled:cursor-not-allowed disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50',
  '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
)

const variants: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-primary text-primary-foreground hover:not-data-disabled:bg-primary/90',
  secondary: 'border-transparent bg-secondary text-secondary-foreground hover:not-data-disabled:bg-secondary/80',
  ghost: 'border-transparent bg-transparent text-foreground hover:not-data-disabled:bg-accent hover:not-data-disabled:text-accent-foreground',
  outline:
    'border-input bg-background text-foreground hover:not-data-disabled:bg-accent hover:not-data-disabled:text-accent-foreground',
  destructive: 'border-transparent bg-destructive text-destructive-foreground hover:not-data-disabled:bg-destructive/90',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-xs',
  md: 'h-9 gap-2 px-4 text-sm',
  icon: 'size-9 gap-0 p-0 text-sm',
}

/**
 * Kit classes for a button look, for Base UI parts that render their own button
 * (Dialog.Close, Toast.Action) or for `render` targets.
 * @param options.variant - visual family (default 'primary').
 * @param options.size - control size (default 'md').
 * @returns the utility class string.
 */
export function buttonClassName({ variant = 'primary', size = 'md' }: { variant?: ButtonVariant; size?: ButtonSize } = {}): string {
  return clsx(base, variants[variant], sizes[size])
}

/**
 * Render a button.
 * @param props.variant - 'primary' | 'secondary' | 'ghost' | 'outline' | 'destructive' (default 'primary').
 * @param props.size - 'sm' | 'md' | 'icon' (default 'md'); 'icon' needs `aria-label` and excludes destructive.
 * @param props.icon - leading icon; required for destructive.
 * @returns the Base UI button; all Base UI Button props pass through, including a className callback.
 */
export function Button({ variant = 'primary', size = 'md', icon, className, children, ...rest }: ButtonProps) {
  return (
    <BaseButton {...rest} className={mergeClassName(buttonClassName({ variant, size }), className)}>
      {icon}
      {children}
    </BaseButton>
  )
}
