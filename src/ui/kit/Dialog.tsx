// Dialog: styled Base UI Dialog parts. Import as a namespace. `Root`, `Trigger` and
// `Portal` are Base UI's own parts (style Trigger through `render`, e.g.
// `<Dialog.Trigger render={<Button variant="outline">Open</Button>} />`); `Content`
// composes Portal + Backdrop + Popup for the common case.

import type { ComponentPropsWithRef } from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import clsx from 'clsx'
import { buttonClassName, type SafeButtonVariant } from './Button'
import { mergeClassName, type StateClassName } from './shared'

export const Root = BaseDialog.Root
export const Trigger = BaseDialog.Trigger
export const Portal = BaseDialog.Portal

export type RootProps = BaseDialog.Root.Props
export type TriggerProps = BaseDialog.Trigger.Props
export type BackdropProps = BaseDialog.Backdrop.Props
export type PopupProps = BaseDialog.Popup.Props
export type TitleProps = BaseDialog.Title.Props
export type DescriptionProps = BaseDialog.Description.Props

const backdropClass = clsx(
  'fixed inset-0 z-50 bg-background/70 backdrop-blur-xs transition-opacity duration-150 motion-reduce:transition-none',
  'data-starting-style:opacity-0 data-ending-style:opacity-0',
)

const popupClass = clsx(
  'fixed top-1/2 left-1/2 z-50 box-border flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto',
  'rounded-xl border border-solid border-border bg-popover p-6 text-popover-foreground shadow-xl outline-none',
  'transition-[opacity,scale] duration-150 ease-out motion-reduce:transition-none',
  'data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0',
)

/** Dimming layer behind the popup. */
export function Backdrop({ className, ...props }: BackdropProps) {
  return <BaseDialog.Backdrop {...props} className={mergeClassName(backdropClass, className)} />
}

/** The dialog surface; render inside Portal (or use Content). */
export function Popup({ className, ...props }: PopupProps) {
  return <BaseDialog.Popup {...props} className={mergeClassName(popupClass, className)} />
}

export type ContentProps = PopupProps & {
  /** Extra classes for the backdrop; same string-or-callback form as Base UI. */
  backdropClassName?: StateClassName<BaseDialog.Backdrop.State>
}

/**
 * Portal + Backdrop + Popup in one part.
 * @param props.backdropClassName - extra backdrop classes.
 * @returns the portalled dialog surface; Popup props pass through.
 */
export function Content({ backdropClassName, ...props }: ContentProps) {
  return (
    <BaseDialog.Portal>
      <Backdrop className={backdropClassName} />
      <Popup {...props} />
    </BaseDialog.Portal>
  )
}

/** Dialog heading (renders an <h2>; margins reset for the no-preflight build). */
export function Title({ className, ...props }: TitleProps) {
  return (
    <BaseDialog.Title
      {...props}
      className={mergeClassName('m-0 text-base font-semibold leading-tight text-foreground', className)}
    />
  )
}

/** Supporting text (renders a <p>). */
export function Description({ className, ...props }: DescriptionProps) {
  return (
    <BaseDialog.Description
      {...props}
      className={mergeClassName('m-0 text-sm leading-5 text-muted-foreground', className)}
    />
  )
}

export type CloseProps = BaseDialog.Close.Props & {
  /** Button look (default 'outline'); destructive actions belong on a labelled Button, not Close. */
  variant?: SafeButtonVariant | undefined
}

/** Closes the dialog; styled as a Button. */
export function Close({ className, variant = 'outline', ...props }: CloseProps) {
  return <BaseDialog.Close {...props} className={mergeClassName(buttonClassName({ variant, size: 'md' }), className)} />
}

/** Right-aligned action row for the bottom of a dialog. */
export function Footer({ className, ...props }: ComponentPropsWithRef<'div'>) {
  return <div {...props} className={clsx('flex flex-wrap items-center justify-end gap-2', className)} />
}
