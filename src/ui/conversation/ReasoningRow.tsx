import { memo, useCallback, useMemo, useState } from "react";
import { DisclosureRow, IconThinkOutlineRegular, MarkdownText, TextShimmer } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ReasoningItem } from "../../../shared/protocol";
import { useT } from "../../i18n";
import { TESTID } from "../testids";
import { formatWholeSeconds } from "./format";
import { useConversationLabels } from "./labels";
import clsx from "clsx";

const THINK_ICON = <IconThinkOutlineRegular size={14} />;
const MIN_REPORTED_THINKING_MS = 1000;

function latestCompletedParagraphFirstLine(text: string): string {
  let summary = "";
  let paragraphStart = 0;
  const separator = /\r?\n(?:[\t ]*\r?\n)+/g;
  for (;;) {
    const nextParagraph = separator.exec(text);
    const paragraphEnd =
      nextParagraph === null ? text.length : nextParagraph.index + nextParagraph[0].indexOf("\n");
    const newline = text.indexOf("\n", paragraphStart);
    if (newline !== -1 && newline <= paragraphEnd) {
      const candidate = text.slice(paragraphStart, newline).trim();
      if (candidate !== "") summary = candidate;
    }
    if (nextParagraph === null) return summary;
    paragraphStart = nextParagraph.index + nextParagraph[0].length;
  }
}

/** DSH ReasoningRow port: collapsed by default, a live one-line preview while streaming. */
export const ReasoningRow = memo(function ReasoningRow({
  item,
  streaming,
  durationMs,
}: {
  item: ReasoningItem;
  streaming: boolean;
  durationMs: number | null;
}) {
  const t = useT();
  const labels = useConversationLabels();
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const content = useMemo(() => item.content.join("\n\n").trim(), [item.content]);
  const summary = useMemo(() => item.summary.join("\n\n").trim(), [item.summary]);
  const text = content === "" ? summary : content;
  const expandable = text !== "";
  const open = expanded && expandable;
  const preview = useMemo(
    () => (streaming && !open ? latestCompletedParagraphFirstLine(text).replaceAll("**", "") : ""),
    [streaming, open, text],
  );
  const title = streaming
    ? t("conversation.reasoning.thinking")
    : durationMs === null || durationMs < MIN_REPORTED_THINKING_MS
      ? t("conversation.reasoning.thought")
      : t("conversation.reasoning.thoughtFor", { duration: formatWholeSeconds(durationMs, t) });
  const collapsedContent = useMemo(
    () =>
      preview === "" ? undefined : (
        <>
          <span className="mx-2 size-0.5 flex-none rounded-full bg-muted-foreground" data-shimmer-decoration aria-hidden />
          <span className="min-w-0 flex-auto overflow-hidden text-[13px] leading-5 whitespace-nowrap [mask-image:linear-gradient(to_right,black_calc(100%-48px),transparent)]">
            <span className="block overflow-visible">
              <TextShimmer>{preview}</TextShimmer>
            </span>
          </span>
        </>
      ),
    [preview],
  );
  const body = useMemo(
    () =>
      open ? (
        <div className="flex min-w-0 flex-col gap-2 py-1 pl-[22px] text-muted-foreground">
          {summary !== "" && content !== "" && (
            <div className="flex flex-col gap-0.5 border-0 border-b border-solid border-border pb-2">
              <div className="text-xs leading-5 text-muted-foreground">{t("conversation.reasoning.summary")}</div>
              <MarkdownText text={summary} streaming={streaming} labels={labels.markdown} variant="compact" />
            </div>
          )}
          <MarkdownText text={text} streaming={streaming} labels={labels.markdown} variant="compact" />
        </div>
      ) : undefined,
    [open, summary, content, text, streaming, labels, t],
  );
  return (
    <div
      className={clsx(
        "flex min-w-0 flex-col",
        open
          ? "[&_[data-open]_[data-disclosure-row]]:sticky [&_[data-open]_[data-disclosure-row]]:top-0 [&_[data-open]_[data-disclosure-row]]:z-[1] [&_[data-open]_[data-disclosure-row]]:bg-background"
          : "h-6 [contain:size_layout]",
      )}
      data-testid={TESTID.reasoning}
      data-item-id={item.id}
      data-streaming={streaming || undefined}
      data-expanded={open || undefined}
      data-flow="reasoning"
    >
      {streaming && <span className="sr-only">{t("conversation.tool.state.running")}</span>}
      <DisclosureRow
        rowClassName="overflow-hidden rounded-sm"
        leadingClassName="shrink-0"
        titleClassName="font-normal"
        icon={THINK_ICON}
        title={title}
        running={streaming}
        open={open}
        expandable={expandable}
        expandOnRowClick
        onToggle={toggle}
        collapsedContent={collapsedContent}
      >
        {body}
      </DisclosureRow>
    </div>
  );
});
