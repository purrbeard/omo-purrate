// Tabs: styled Base UI Tabs parts. Import as a namespace (`Tabs.Root`, `Tabs.List`,
// `Tabs.Tab`, `Tabs.Indicator`, `Tabs.Panel`); each part keeps Base UI's props,
// including the className state callback.

import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import clsx from 'clsx'
import { focusRing, mergeClassName } from './shared'

const rootClass = 'flex flex-col gap-3 data-[orientation=vertical]:flex-row'

const listClass = clsx(
  'relative isolate box-border inline-flex w-fit items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground',
  'data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch',
)

const tabClass = clsx(
  'relative z-10 box-border m-0 inline-flex h-7 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap',
  'rounded-md border-0 bg-transparent px-3 [font-family:inherit] text-sm font-medium leading-none text-muted-foreground',
  'transition-colors duration-150 motion-reduce:transition-none hover:not-data-disabled:text-foreground data-active:text-foreground',
  focusRing,
  'data-disabled:cursor-not-allowed data-disabled:opacity-50',
  '[&_svg]:size-4 [&_svg]:shrink-0',
)

const indicatorClass = clsx(
  'absolute top-(--active-tab-top) left-(--active-tab-left) z-0 h-(--active-tab-height) w-(--active-tab-width)',
  'rounded-md bg-background shadow-sm',
)

const panelClass = clsx('rounded-md text-foreground', focusRing)

export type RootProps = BaseTabs.Root.Props
export type ListProps = BaseTabs.List.Props
export type TabProps = BaseTabs.Tab.Props
export type IndicatorProps = BaseTabs.Indicator.Props
export type PanelProps = BaseTabs.Panel.Props

/** Groups the tabs and panels. */
export function Root({ className, ...props }: RootProps) {
  return <BaseTabs.Root {...props} className={mergeClassName(rootClass, className)} />
}

/** Segmented track holding the tabs and the active indicator. */
export function List({ className, ...props }: ListProps) {
  return <BaseTabs.List {...props} className={mergeClassName(listClass, className)} />
}

/** A tab button; active state shown by text color and the indicator surface. */
export function Tab({ className, ...props }: TabProps) {
  return <BaseTabs.Tab {...props} className={mergeClassName(tabClass, className)} />
}

/** Sliding surface behind the active tab; place inside List after the tabs. */
export function Indicator({ className, ...props }: IndicatorProps) {
  return <BaseTabs.Indicator {...props} className={mergeClassName(indicatorClass, className)} />
}

/** Panel content; Base UI hides inactive panels with the `hidden` attribute. */
export function Panel({ className, ...props }: PanelProps) {
  return <BaseTabs.Panel {...props} className={mergeClassName(panelClass, className)} />
}
