import { Tooltip } from "@deepseek-ai/dsh-client-ui-primitives";
import { useT } from "../../i18n";
import { useContextUsage } from "./use-context-usage";
import css from "./ContextGauge.module.css";

export function ContextGauge() {
  const t = useT();
  const usage = useContextUsage();
  if (usage === null) return null;
  const threshold = Math.max(0, usage.window - 16384);
  const percent = usage.tokens === null ? null : Math.round(usage.tokens / usage.window * 100);
  const level = usage.tokens === null ? "unknown" : usage.tokens >= threshold * 0.95 ? "critical" : usage.tokens >= threshold * 0.8 ? "warning" : "normal";
  const label = usage.tokens === null ? t("composer.context.compacted") :
    `${t("composer.context.usage", { used: usage.tokens, window: usage.window, pct: percent ?? 0 })}\n${t("composer.context.autoCompact", { threshold })}`;
  return (
    <Tooltip label={label} side="top" delayMs={500}>
      <span className={css.gauge} tabIndex={0} aria-label={label} data-testid="context-gauge"
        data-level={level} data-tokens={usage.tokens ?? ""} data-window={usage.window} data-percent={percent ?? ""}>
        <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
          <circle className={css.track} cx="10" cy="10" r="7" />
          {percent !== null && <circle className={css.fill} cx="10" cy="10" r="7" pathLength="100"
            strokeDasharray={`${Math.min(100, Math.max(0, (usage.tokens ?? 0) / usage.window * 100))} 100`} transform="rotate(-90 10 10)" />}
        </svg>
        <span>{percent === null ? "—" : `${percent}%`}</span>
      </span>
    </Tooltip>
  );
}
