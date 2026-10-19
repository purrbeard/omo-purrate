import type { ReactNode } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import clsx from "clsx";
import { Dialog } from "../kit";

const popupClass = clsx(
  "fixed top-1/2 left-1/2 z-50 box-border flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col gap-4",
  "rounded-xl border border-solid border-border bg-popover p-6 font-sans text-popover-foreground shadow-xl outline-none",
  "transition-[opacity,scale] duration-150 ease-out motion-reduce:transition-none",
  "data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0",
);

/**
 * A table-sized dialog: kit backdrop, title and description around a 56rem popup whose body (the table) owns
 * vertical scrolling, so long session lists never push the actions off screen or clip horizontally.
 */
export function WideDialog({ title, description, onClose, footer, children, testId }: {
  title: string;
  description?: ReactNode;
  onClose(): void;
  footer: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <BaseDialog.Popup className={popupClass} data-testid={testId}>
          <div className="flex flex-col gap-1.5">
            <Dialog.Title>{title}</Dialog.Title>
            {description !== undefined && <Dialog.Description render={<div />}>{description}</Dialog.Description>}
          </div>
          {children}
          <Dialog.Footer>{footer}</Dialog.Footer>
        </BaseDialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
