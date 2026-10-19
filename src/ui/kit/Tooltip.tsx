// Tooltip: styled Base UI Tooltip parts. Import as a namespace. `Provider`, `Root`,
// `Trigger` and `Portal` are Base UI's own parts (generic payload typing intact);
// `Content` composes Portal + Positioner + Popup.
//
//   <Tooltip.Root>
//     <Tooltip.Trigger render={<IconButton icon={<Copy />} label={t('copy')} />} />
//     <Tooltip.Content>{t('copy')}</Tooltip.Content>
//   </Tooltip.Root>

import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import clsx from 'clsx'
import { mergeClassName } from './shared'

export const Provider = BaseTooltip.Provider
export const Root = BaseTooltip.Root
export const Trigger = BaseTooltip.Trigger
export const Portal = BaseTooltip.Portal

export type ProviderProps = BaseTooltip.Provider.Props
export type RootProps<Payload = unknown> = BaseTooltip.Root.Props<Payload>
export type TriggerProps<Payload = unknown> = BaseTooltip.Trigger.Props<Payload>
export type PositionerProps = BaseTooltip.Positioner.Props
export type PopupProps = BaseTooltip.Popup.Props

const popupClass = clsx(
  'box-border max-w-xs origin-(--transform-origin) rounded-md bg-foreground px-2 py-1',
  'text-xs font-medium leading-4 text-background shadow-md',
  'transition-[opacity,scale] duration-100 ease-out data-instant:transition-none motion-reduce:transition-none',
  'data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0',
)

/** Anchors the popup to the trigger; defaults to a 6px side offset. */
export function Positioner({ className, sideOffset = 6, ...props }: PositionerProps) {
  return <BaseTooltip.Positioner {...props} sideOffset={sideOffset} className={mergeClassName('z-50', className)} />
}

/** The tooltip bubble (inverted foreground/background tokens). */
export function Popup({ className, ...props }: PopupProps) {
  return <BaseTooltip.Popup {...props} className={mergeClassName(popupClass, className)} />
}

export type ContentProps = PopupProps & Pick<PositionerProps, 'side' | 'align' | 'sideOffset' | 'alignOffset'>

/**
 * Portal + Positioner + Popup in one part.
 * @param props.side / align / sideOffset / alignOffset - forwarded to the Positioner.
 * @returns the portalled bubble; Popup props pass through.
 */
export function Content({ side, align, sideOffset, alignOffset, ...props }: ContentProps) {
  return (
    <BaseTooltip.Portal>
      <Positioner side={side} align={align} sideOffset={sideOffset} alignOffset={alignOffset}>
        <Popup {...props} />
      </Positioner>
    </BaseTooltip.Portal>
  )
}
