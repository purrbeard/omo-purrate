// IconButton: icon-only Button with a required accessible name. Destructive is
// excluded at the type level because an icon-only control has no visible text label.

import type { ReactNode } from 'react'
import type { Button as BaseButton } from '@base-ui/react/button'
import { Button, type SafeButtonVariant } from './Button'

export type IconButtonProps = Omit<BaseButton.Props, 'children' | 'aria-label'> & {
  /** The icon node (for example a lucide-react icon). */
  icon: ReactNode
  /** Localized accessible name, owned by the render site. */
  label: string
  /** Visual family (default 'ghost'); 'destructive' is not allowed. */
  variant?: SafeButtonVariant | undefined
}

/**
 * Render an icon-only button.
 * @param props.icon - the icon node.
 * @param props.label - accessible name, applied as aria-label.
 * @param props.variant - non-destructive variant (default 'ghost').
 * @returns a 36px square Button; Base UI Button props pass through.
 */
export function IconButton({ icon, label, variant = 'ghost', ...rest }: IconButtonProps) {
  return (
    <Button {...rest} variant={variant} size="icon" aria-label={label}>
      {icon}
    </Button>
  )
}
