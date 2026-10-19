// Toast: Base UI Toast with four typed kinds. Import as a namespace:
//
//   <Toast.Provider timeout={5000}>          // app-wide default auto-dismiss (ms, 0 = never)
//     ...
//     <Toast.Viewport closeLabel={t('common.dismiss')} />
//   </Toast.Provider>
//
//   const toast = Toast.useToast()
//   toast.add({ type: 'error', title: t('save.failed'), description: err.message })
//
// Every toast renders its kind's icon and a close button. An error toast requires a
// title and defaults to `timeout: 0` (stays until dismissed) and `priority: 'high'`;
// pass `timeout` to override per toast.

import type { ReactNode } from 'react'
import { Toast as BaseToast } from '@base-ui/react/toast'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import { buttonClassName } from './Button'
import { focusRing, mergeClassName, type VisibleLabel } from './shared'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

type ManagerAddOptions = Parameters<ReturnType<typeof BaseToast.useToastManager>['add']>[0]

type CommonToastOptions = Omit<ManagerAddOptions, 'type' | 'title'> & {
  description?: ReactNode
}

type ErrorToastOptions = {
  type: 'error'
  /** Required visible heading; errors are never conveyed by icon and color alone. */
  title: VisibleLabel
}

type StatusToastOptions = {
  /** Kind of toast (default 'info'). */
  type?: Exclude<ToastType, 'error'> | undefined
  title?: ReactNode
}

/** Options for `useToast().add`: Base UI's add options with a typed `type` contract. */
export type ToastOptions = CommonToastOptions & (ErrorToastOptions | StatusToastOptions)

export const Provider = BaseToast.Provider
export type ProviderProps = BaseToast.Provider.Props

function toManagerOptions(options: ToastOptions): ManagerAddOptions {
  const type: ToastType = options.type ?? 'info'
  if (type === 'error') return { timeout: 0, priority: 'high', ...options, type }
  return { ...options, type }
}

/**
 * Typed toast API for components under Provider.
 * @returns `add(options)` returning the toast id, and `close(id?)`.
 */
export function useToast() {
  const manager = BaseToast.useToastManager()
  return {
    add: (options: ToastOptions): string => manager.add(toManagerOptions(options)),
    close: manager.close,
  }
}

const icons: Record<ToastType, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
}

const iconTone: Record<ToastType, string> = {
  info: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-destructive-foreground',
}

function toastType(value: string | undefined): ToastType {
  return value === 'success' || value === 'warning' || value === 'error' ? value : 'info'
}

const viewportClass = clsx(
  'fixed right-4 bottom-4 z-50 box-border flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 outline-none',
)

const rootClass = clsx(
  'relative box-border flex w-full select-none items-start gap-3 rounded-lg border border-solid border-border bg-popover py-3 pr-2 pl-3',
  'text-popover-foreground shadow-lg',
  'translate-x-(--toast-swipe-movement-x) transition-[opacity,translate] duration-200 ease-out data-swiping:transition-none motion-reduce:transition-none',
  'data-starting-style:translate-y-2 data-starting-style:opacity-0 data-ending-style:opacity-0 data-limited:hidden',
  'data-[type=error]:border-destructive-foreground/50',
)

const closeClass = clsx(
  'box-border m-0 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0',
  'text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-accent hover:text-accent-foreground',
  focusRing,
)

function ToastItem({ toast, closeLabel }: { toast: BaseToast.Root.ToastObject; closeLabel: string }) {
  const type = toastType(toast.type)
  const Icon = icons[type]
  return (
    <BaseToast.Root toast={toast} swipeDirection="right" className={rootClass}>
      <Icon aria-hidden="true" className={clsx('mt-0.5 size-4 shrink-0', iconTone[type])} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {toast.title != null && <BaseToast.Title className="m-0 text-sm font-semibold leading-5 text-popover-foreground" />}
        {toast.description != null && (
          <BaseToast.Description className="m-0 text-sm leading-5 text-muted-foreground" />
        )}
        {toast.actionProps != null && (
          <BaseToast.Action className={clsx(buttonClassName({ variant: 'outline', size: 'sm' }), 'mt-1 self-start')} />
        )}
      </div>
      <BaseToast.Close aria-label={closeLabel} className={closeClass}>
        <X aria-hidden="true" className="size-4" />
      </BaseToast.Close>
    </BaseToast.Root>
  )
}

export type ViewportProps = Omit<BaseToast.Viewport.Props, 'children'> & {
  /** Localized accessible name for each toast's close button. */
  closeLabel: string
}

/**
 * Portalled bottom-right stack rendering every toast from the Provider.
 * @param props.closeLabel - accessible name for the close buttons.
 * @returns the portalled Base UI Toast.Viewport; its props pass through.
 */
export function Viewport({ className, closeLabel, ...props }: ViewportProps) {
  const { toasts } = BaseToast.useToastManager()
  return (
    <BaseToast.Portal>
      <BaseToast.Viewport {...props} className={mergeClassName(viewportClass, className)}>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} closeLabel={closeLabel} />
        ))}
      </BaseToast.Viewport>
    </BaseToast.Portal>
  )
}
