// Settings page building blocks: Tailwind utilities over the semantic tokens and kit primitives.
// Every settings section composes these, so cards, rows, type and errors stay uniform.
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import clsx from "clsx";
import { CircleAlert } from "lucide-react";
import { SwitchRoot, SwitchThumb, Tabs, focusRing } from "../kit";

/** Shared utility strings for markup the components below do not wrap. */
export const ui = {
  /** One settings page column; 720px keeps rows readable on wide windows. */
  section: "flex w-full max-w-180 flex-col gap-3",
  card: "box-border flex w-full flex-col rounded-xl border border-solid border-border bg-card px-5 text-card-foreground",
  cardBody: "flex flex-col gap-3 py-4 [&>button]:self-start",
  cardFooter: "m-0 pb-4 text-sm leading-5 text-muted-foreground",
  heading: "m-0 text-sm font-semibold leading-5 text-foreground",
  subheading: "m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground",
  text: "m-0 text-sm leading-5 text-foreground",
  muted: "m-0 text-sm leading-5 text-muted-foreground",
  mono: "font-mono text-xs",
  facts: clsx(
    "m-0 grid w-full grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2.5 text-sm leading-5",
    "[&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:wrap-anywhere [&_dd]:text-foreground",
  ),
  codeBlock: clsx(
    "m-0 box-border block max-h-33 w-full overflow-auto rounded-md bg-muted px-3 py-2.5",
    "font-mono text-xs leading-4.5 text-muted-foreground [font-variant-ligatures:none] whitespace-pre-wrap wrap-anywhere",
  ),
  /** Bordered input surface without size, padding or type size; pair it with those. */
  field: clsx(
    "box-border rounded-md border border-solid border-input bg-background [font-family:inherit] text-foreground",
    "disabled:cursor-not-allowed disabled:opacity-50",
    focusRing,
  ),
  /** A 32px control: `field` plus height, padding and type. */
  control: clsx(
    "box-border h-8 rounded-md border border-solid border-input bg-background px-2.5 [font-family:inherit] text-sm text-foreground",
    "disabled:cursor-not-allowed disabled:opacity-50",
    focusRing,
  ),
  link: clsx(
    "inline-flex w-fit cursor-pointer items-center gap-1 rounded-sm border-0 bg-transparent p-0 [font-family:inherit] text-sm leading-5",
    "text-foreground no-underline underline-offset-4 hover:underline [&_svg]:size-3.5",
    focusRing,
  ),
  badge: "inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-xs leading-4 text-muted-foreground",
} as const;

/** Native select styled as a settings control. */
export const selectClass = clsx(ui.control, "min-w-55 max-w-80 cursor-pointer");

/** Heading above a settings column's cards: title plus muted intro. */
export function SettingsGroup({ title, intro, children }: { title: string; intro?: string | undefined; children?: ReactNode }) {
  return (
    <header className="mb-1 flex items-start justify-between gap-5">
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="m-0 text-base font-semibold leading-6 text-foreground">{title}</h3>
        {intro !== undefined && <p className={ui.muted}>{intro}</p>}
      </div>
      {children}
    </header>
  );
}

/** Rounded card that groups related rows; rows inside divide themselves with hairlines. */
export function SettingsCard({ children, testId, dataAttrs, className, ...rest }: Omit<ComponentPropsWithoutRef<"div">, "children"> & {
  children: ReactNode;
  testId?: string | undefined;
  dataAttrs?: Record<string, string>;
}) {
  return (
    <div {...rest} className={clsx(ui.card, className)} data-testid={testId} {...dataAttrs}>
      {children}
    </div>
  );
}

/** One preference row: title, muted description, and the control at the right edge. */
export function SettingsRow({ title, description, children }: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-0 border-solid border-border py-4 [&+&]:border-t">
      <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
        <div className="text-sm leading-5 font-medium text-foreground">{title}</div>
        {description !== undefined && <div className="flex flex-col gap-0.5 text-xs leading-4.5 text-muted-foreground">{description}</div>}
      </div>
      {children !== undefined && <div className="flex max-w-full flex-none items-center gap-2">{children}</div>}
    </div>
  );
}

/** Switch control for boolean preferences (kit Switch parts, labelled by `label`). */
export function Toggle({ checked, disabled, label, onChange, testId }: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange(): void;
  testId?: string;
}) {
  return (
    <SwitchRoot checked={checked} disabled={disabled} aria-label={label} data-testid={testId} onCheckedChange={() => onChange()}>
      <SwitchThumb />
    </SwitchRoot>
  );
}

/** An error line: alert icon plus visible text, never color alone. */
export function ErrorText({ children, className, ...rest }: Omit<ComponentPropsWithoutRef<"p">, "children"> & { children: ReactNode }) {
  return (
    <p role="alert" {...rest} className={clsx("m-0 flex items-start gap-1.5 text-sm leading-5 text-destructive-foreground", className)}>
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 wrap-anywhere">{children}</span>
    </p>
  );
}

/** A one-of-few choice rendered as a segmented track (kit Tabs without panels). */
export function Segmented<Value extends string>({ value, options, label, onChange, disabled }: {
  value: Value;
  options: readonly { value: Value; label: string }[];
  label: string;
  onChange(next: Value): void;
  disabled?: boolean;
}) {
  return (
    <Tabs.Root value={value} onValueChange={(next) => onChange(next as Value)}>
      <Tabs.List aria-label={label}>
        {options.map((option) => (
          <Tabs.Tab key={option.value} value={option.value} disabled={disabled}>
            {option.label}
          </Tabs.Tab>
        ))}
        <Tabs.Indicator />
      </Tabs.List>
    </Tabs.Root>
  );
}
