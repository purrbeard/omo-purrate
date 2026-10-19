// UI kit: Base UI headless parts styled with Tailwind utilities and semantic color
// tokens. Simple controls are plain components; compound ones are namespaces
// (`Tabs.Root`, `Dialog.Content`, `Menu.Item`, `Tooltip.Content`, `Toast.Viewport`).

export { Button, buttonClassName } from './Button'
export type { ButtonProps, ButtonSize, ButtonVariant, SafeButtonVariant } from './Button'
export { IconButton } from './IconButton'
export type { IconButtonProps } from './IconButton'
export { Switch, SwitchRoot, SwitchThumb } from './Switch'
export type { SwitchProps } from './Switch'
export { Badge } from './Badge'
export type { BadgeProps, BadgeVariant } from './Badge'
export { Input, InputError } from './Input'
export type { InputErrorProps, InputProps } from './Input'
export * as Tabs from './Tabs'
export * as Dialog from './Dialog'
export * as Menu from './Menu'
export * as Tooltip from './Tooltip'
export * as Toast from './Toast'
export type { ToastOptions, ToastType } from './Toast'
export { focusRing, mergeClassName } from './shared'
export type { RequiredIcon, StateClassName, VisibleLabel } from './shared'

// content track
export { StateDot } from './StateDot'
export type { StateDotProps, StateDotState } from './StateDot'
export { TextShimmer } from './TextShimmer'
export type { TextShimmerProps } from './TextShimmer'
export { DisclosureRow } from './DisclosureRow'
export type { DisclosureRowProps } from './DisclosureRow'

// controls track
export { MenuGroup, MenuSurface } from './MenuSurface'
export type { MenuGroupProps, MenuSurfaceProps } from './MenuSurface'
export { ShortcutKeys } from './ShortcutKeys'
export type { ShortcutKeysProps } from './ShortcutKeys'
