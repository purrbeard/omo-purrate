import { useT } from "../../i18n";
import { useContextUsage } from "./use-context-usage";
import clsx from "clsx";
import { focusRing, Tooltip } from "../kit";

/** Small sessions cost cents, so two decimals would read as $0.00. */
const formatCost = (cost: number): string => `$${(cost > 0 && cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2))}`;

export function ContextGauge() {
  const t = useT();
  const usage = useContextUsage();
  if (usage === null) return null;
  const threshold = Math.max(0, usage.window - 16384);
  const percent = usage.tokens === null ? null : Math.round(usage.tokens / usage.window * 100);
  const level = usage.tokens === null ? "unknown" : usage.tokens >= threshold * 0.95 ? "critical" : usage.tokens >= threshold * 0.8 ? "warning" : "normal";
  const totals = [
    usage.totalTokens === null ? null : t("composer.context.totalTokens", { total: usage.totalTokens.toLocaleString("en-US") }),
    usage.cost === null ? null : t("composer.context.cost", { cost: formatCost(usage.cost) }),
  ].filter((line): line is string => line !== null);
  const label = (usage.tokens === null ? t("composer.context.compacted") :
    `${t("composer.context.usage", { used: usage.tokens, window: usage.window, pct: percent ?? 0 })}\n${t("composer.context.autoCompact", { threshold })}`) +
    (totals.length === 0 ? "" : `\n${totals.join(" · ")}`);
  return (
    <Tooltip.Root>
      <Tooltip.Trigger delay={500} render={<span className={clsx("inline-flex shrink-0 items-center gap-1 rounded-sm text-xs tabular-nums text-muted-foreground data-[level=critical]:text-destructive-foreground data-[level=warning]:text-warning", focusRing)} tabIndex={0} aria-label={label} data-testid="context-gauge"
        data-level={level} data-tokens={usage.tokens ?? ""} data-window={usage.window} data-percent={percent ?? ""} data-total-tokens={usage.totalTokens ?? ""} data-cost={usage.cost ?? ""}>
        <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
          <circle className="fill-none stroke-border stroke-2" cx="10" cy="10" r="7" />
          {percent !== null && <circle className="fill-none stroke-current stroke-2" cx="10" cy="10" r="7" pathLength="100"
            strokeDasharray={`${Math.min(100, Math.max(0, (usage.tokens ?? 0) / usage.window * 100))} 100`} transform="rotate(-90 10 10)" />}
        </svg>
        <span>{percent === null ? "—" : `${percent}%`}</span>
      </span>} />
      <Tooltip.Content side="top" className="whitespace-pre-line">{label}</Tooltip.Content>
    </Tooltip.Root>
  );
}
