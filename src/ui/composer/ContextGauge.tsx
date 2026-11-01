import { useT } from "../../i18n";
import { useContextUsage } from "./use-context-usage";
import clsx from "clsx";
import { focusRing, Tooltip } from "../kit";

/** Small sessions cost cents, so two decimals would read as $0.00. */
const formatCost = (cost: number): string => `$${(cost > 0 && cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2))}`;
const count = (value: number | null): string => value === null ? "-" : value.toLocaleString("en-US");

export function ContextGauge() {
  const t = useT();
  const usage = useContextUsage();
  if (usage === null) return null;
  const threshold = Math.max(0, usage.window - 16384);
  const percent = usage.tokens === null ? null : Math.round(usage.tokens / usage.window * 100);
  const level = usage.tokens === null ? "unknown" : usage.tokens >= threshold * 0.95 ? "critical" : usage.tokens >= threshold * 0.8 ? "warning" : "normal";
  const contextLabel = usage.tokens === null ? t("composer.context.compacted") :
    `${t("composer.context.usage", { used: usage.tokens, window: usage.window, pct: percent ?? 0 })}\n${t("composer.context.autoCompact", { threshold })}`;
  const components = [
    { id: "input", label: t("usage.input"), value: usage.input, fill: "bg-background" },
    { id: "output", label: t("usage.output"), value: usage.output, fill: "bg-background/70" },
    { id: "cache-read", label: t("usage.cacheRead"), value: usage.cacheRead, fill: "bg-background/40" },
    { id: "cache-write", label: t("usage.cacheWrite"), value: usage.cacheWrite, fill: "bg-background/20" },
  ] as const;
  const sum = components.every(component => component.value !== null) ? components.reduce((total, component) => total + (component.value ?? 0), 0) : null;
  const total = t("composer.context.totalTokens", { total: count(usage.totalTokens) });
  const cost = t("composer.context.cost", { cost: usage.cost === null ? "-" : formatCost(usage.cost) });
  const label = `${contextLabel}\n${t("usage.session")}\n${components.map(component => `${component.label}: ${count(component.value)}`).join("\n")}\n${total} · ${cost}`;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger delay={500} render={<span className={clsx("inline-flex min-h-6 shrink-0 items-center gap-1 rounded-sm text-xs tabular-nums text-muted-foreground data-[level=critical]:text-destructive-foreground data-[level=warning]:text-warning", focusRing)} tabIndex={0} aria-label={label} data-testid="context-gauge"
        data-level={level} data-tokens={usage.tokens ?? ""} data-window={usage.window} data-percent={percent ?? ""} data-total-tokens={usage.totalTokens ?? ""} data-cost={usage.cost ?? ""}
        data-input={usage.input ?? ""} data-output={usage.output ?? ""} data-cache-read={usage.cacheRead ?? ""} data-cache-write={usage.cacheWrite ?? ""}>
        <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
          <circle className="fill-none stroke-border stroke-2" cx="10" cy="10" r="7" />
          {percent !== null && <circle className="fill-none stroke-current stroke-2" cx="10" cy="10" r="7" pathLength="100"
            strokeDasharray={`${Math.min(100, Math.max(0, (usage.tokens ?? 0) / usage.window * 100))} 100`} transform="rotate(-90 10 10)" />}
        </svg>
        <span>{percent === null ? "-" : `${percent}%`}</span>
      </span>} />
      <Tooltip.Content side="top" className="w-64 max-w-[calc(100vw-2rem)] p-3" data-testid="context-usage-detail">
        <div className="whitespace-pre-line">{contextLabel}</div>
        <div className="mt-3 mb-2">{t("usage.session")}</div>
        {sum !== null && sum > 0 && (
          <div className="mb-2 flex h-2 overflow-hidden rounded-sm" data-testid="context-session-composition" aria-hidden="true">
            {components.map(component => <span key={component.id} className={component.fill} data-component={component.id}
              style={{ width: `${(component.value ?? 0) / sum * 100}%` }} />)}
          </div>
        )}
        <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 tabular-nums">
          {components.map(component => <div className="contents" key={component.id}>
            <dt className="flex items-center gap-1.5"><span className={clsx("size-2 shrink-0 rounded-sm", component.fill)} aria-hidden="true" />{component.label}</dt>
            <dd className="m-0 text-right" data-testid={`context-session-${component.id}`}>{count(component.value)}</dd>
          </div>)}
        </dl>
        <div className="mt-2 flex flex-col gap-1 tabular-nums"><span>{total}</span><span>{cost}</span></div>
      </Tooltip.Content>
    </Tooltip.Root>
  );
}
