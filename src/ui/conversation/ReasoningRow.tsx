import { memo, useCallback, useMemo, useState } from "react";
import { DisclosureRow, IconThinkOutlineRegular, MarkdownText, TextShimmer } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ReasoningItem } from "../../../shared/protocol";
import { useT } from "../../i18n";
import { TESTID } from "../testids";
import { formatWholeSeconds } from "./format";
import { useConversationLabels } from "./labels";
import a11y from "./a11y.module.css";
import css from "./ReasoningRow.module.css";

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
          <span className={css.separator} data-shimmer-decoration aria-hidden />
          <span className={css.preview}>
            <span className={css.previewText}>
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
        <div className={css.body}>
          {summary !== "" && content !== "" && (
            <div className={css.section}>
              <div className={css.sectionLabel}>{t("conversation.reasoning.summary")}</div>
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
      className={css.root}
      data-testid={TESTID.reasoning}
      data-item-id={item.id}
      data-streaming={streaming || undefined}
      data-expanded={open || undefined}
      data-flow="reasoning"
    >
      {streaming && <span className={a11y.visuallyHidden}>{t("conversation.tool.state.running")}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
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
