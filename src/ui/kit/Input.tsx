// Input: styled Base UI Input plus an error message part. The invalid border is
// only a supplement; InputError always pairs an icon with visible text.

import type { ComponentPropsWithRef } from 'react'
import { Input as BaseInput } from '@base-ui/react/input'
import { CircleAlert } from 'lucide-react'
import clsx from 'clsx'
import { focusRing, mergeClassName, type VisibleLabel } from './shared'

export type InputProps = BaseInput.Props

const inputClass = clsx(
  'box-border m-0 block h-9 w-full min-w-0 rounded-md border border-solid border-input bg-background px-3 py-1',
  '[font-family:inherit] text-sm leading-5 text-foreground placeholder:text-muted-foreground',
  'transition-colors duration-150 motion-reduce:transition-none',
  focusRing,
  'disabled:cursor-not-allowed disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50',
  'aria-[invalid=true]:border-destructive-foreground data-invalid:border-destructive-foreground',
)

/**
 * Render a text input.
 * @returns the Base UI Input; its props (including onValueChange and a className callback) pass through.
 */
export function Input({ className, ...props }: InputProps) {
  return <BaseInput {...props} className={mergeClassName(inputClass, className)} />
}

export type InputErrorProps = Omit<ComponentPropsWithRef<'p'>, 'children'> & {
  /** Required visible message text. */
  children: VisibleLabel
}

/**
 * Render a validation message with an alert icon. Give it an `id` and point the
 * input's `aria-describedby` at it, and set `aria-invalid` on the input.
 * @returns a <p>; native paragraph props pass through.
 */
export function InputError({ className, children, ...rest }: InputErrorProps) {
  return (
    <p {...rest} className={clsx('m-0 flex items-start gap-1.5 text-xs font-medium leading-4 text-destructive-foreground', className)}>
      <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}
