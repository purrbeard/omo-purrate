import { useState } from "react";
import { useLocale, useT } from "../../i18n";
import { formatClockTime } from "../time-format";
import { useUiState } from "../ui-state";
import css from "./AnswerFooter.module.css";

export function AnswerFooter({ text, completedAt }: { text: string; completedAt: number | null }) {
  const t = useT();
  const locale = useLocale();
  const timeFormat = useUiState().preferences?.timeFormat ?? "system";
  const [copy, setCopy] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  return (
    <div className={css.footer} data-testid="answer-footer">
      <button type="button" className={css.copy} disabled={copy === "copying"} aria-label={t("conversation.answer.copy")}
        onClick={() => {
          setCopy("copying");
          void window.omo.copyText(text).then(() => setCopy("copied"), () => setCopy("failed"));
        }}>
        {t("conversation.answer.copy")}
      </button>
      <span className={css.feedback} role="status">
        {copy === "copied" ? t("conversation.answer.copied") : copy === "failed" ? t("conversation.answer.copyFailed") : ""}
      </span>
      {completedAt !== null && (
        <time className={css.time} dateTime={new Date(completedAt).toISOString()} aria-label={t("conversation.answer.completedAt")}
          data-testid="answer-completed-at">
          {formatClockTime(completedAt, timeFormat, locale)}
        </time>
      )}
    </div>
  );
}
