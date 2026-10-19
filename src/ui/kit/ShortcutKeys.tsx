// ShortcutKeys: one command's key labels as unboxed keycaps. Callers pass the effective,
// platform-formatted labels (see src/ui/shortcuts.ts); this part owns no bindings or copy.

import clsx from 'clsx'

export type ShortcutKeysProps = {
  /** Effective key labels in press order, e.g. ['Ctrl', 'K']. */
  keys: readonly string[]
  className?: string | undefined
}

/**
 * Render the keys of one shortcut.
 * @returns a span of <kbd> elements in the muted caption style.
 */
export function ShortcutKeys({ keys, className }: ShortcutKeysProps) {
  return (
    <span className={clsx('inline-flex flex-none items-center gap-[3px] whitespace-nowrap text-xs leading-4 text-muted-foreground', className)}>
      {keys.map((key, index) => (
        <kbd key={index} className="box-border inline-flex items-center justify-center [font:inherit]">{key}</kbd>
      ))}
    </span>
  )
}
