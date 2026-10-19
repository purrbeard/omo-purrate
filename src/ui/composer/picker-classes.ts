// Shared Tailwind classes for the composer's chip pickers (permission, model, reasoning effort),
// so the row reads as one control family: 28px ghost chips with a menu surface above the composer.

import clsx from "clsx";
import { focusRing } from "../kit";

/** A ghost chip trigger: muted label, accent hover, neutral focus ring. */
export const pickerTrigger = clsx(
  "m-0 flex h-7 min-w-0 cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent pr-1.5 pl-2",
  "text-[13px] font-medium leading-5 text-muted-foreground [font-family:inherit]",
  "transition-colors duration-150 hover:not-disabled:bg-accent hover:not-disabled:text-accent-foreground",
  "aria-expanded:bg-accent aria-expanded:text-accent-foreground disabled:cursor-default disabled:opacity-50 motion-reduce:transition-none",
  focusRing,
);

/** Chevron after a trigger label; rotates while the menu is open. */
export function pickerChevron(open: boolean): string {
  return clsx("flex-none opacity-60 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180");
}

/** Fixed-position menu surface placed by the picker's own measuring code. */
export const pickerMenu = "fixed z-[1100] box-border flex flex-col p-1";

/** A menu row; the selected row keeps the accent surface and a heavier label. */
export function pickerOption(selected: boolean): string {
  return clsx(
    "m-0 flex w-full cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-2 text-left",
    "text-[13px] leading-5 text-popover-foreground [font-family:inherit] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
    selected && "bg-accent font-semibold",
  );
}
