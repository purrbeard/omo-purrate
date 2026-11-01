import clsx from "clsx";
import type { TurnUsage as NativeTurnUsage } from "../../../shared/protocol";
import { useT } from "../../i18n";
import { focusRing, Tooltip } from "../kit";

const count = (value: number | null | undefined): string => value == null ? "-" : value.toLocaleString("en-US");
const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** Native assistant-message sums for one settled turn; input excludes cache reads and writes. */
export function TurnUsage({ usage }: { readonly usage: NativeTurnUsage | null | undefined }) {
  const t = useT();
  const input = usage?.input ?? null;
  const output = usage?.output ?? null;
  const cacheRead = usage?.cacheRead ?? null;
  const cacheWrite = usage?.cacheWrite ?? null;
  const total = usage?.totalTokens ?? null;
  const denominator = input === null || cacheRead === null || cacheWrite === null ? null : input + cacheRead + cacheWrite;
  const hit = denominator !== null && denominator > 0 && cacheRead !== null ? cacheRead / denominator * 100 : null;
  const cache = `${t("usage.cacheHit")} ${hit === null ? "-" : `${percent.format(hit)}%`}`;
  const components = [
    [t("usage.input"), input], [t("usage.output"), output],
    [t("usage.cacheRead"), cacheRead], [t("usage.cacheWrite"), cacheWrite], [t("usage.total"), total],
  ] as const;
  const label = `${t("usage.turn")} · ${cache}\n${components.map(([label, value]) => `${label}: ${count(value)}`).join("\n")}`;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger delay={300} render={<span
        className={clsx("flex min-h-6 w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-sm text-xs leading-5 tabular-nums text-muted-foreground", focusRing)}
        tabIndex={0} aria-label={label} data-testid="turn-usage"
        data-input={input ?? ""} data-output={output ?? ""} data-cache-read={cacheRead ?? ""}
        data-cache-write={cacheWrite ?? ""} data-total-tokens={total ?? ""} data-cache-hit={hit ?? ""}
      >
        <span className="whitespace-nowrap" data-testid="turn-usage-cache">{cache}</span>
        <span className="whitespace-nowrap" data-testid="turn-usage-input">{t("usage.input")} {count(input)}</span>
        <span className="whitespace-nowrap" data-testid="turn-usage-output">{t("usage.output")} {count(output)}</span>
        <span className="whitespace-nowrap" data-testid="turn-usage-total">{t("usage.total")} {count(total)}</span>
      </span>} />
      <Tooltip.Content side="top" className="max-w-xs p-3" data-testid="turn-usage-detail">
        <div className="mb-2">{t("usage.turn")} · {cache}</div>
        <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 tabular-nums">
          {components.map(([label, value]) => <div className="contents" key={label}>
            <dt>{label}</dt><dd className="m-0 text-right">{count(value)}</dd>
          </div>)}
        </dl>
      </Tooltip.Content>
    </Tooltip.Root>
  );
}
