import { useState, type ReactNode } from "react";
import { Check, CircleAlert, Copy } from "lucide-react";
import { useLocale, useT } from "../../i18n";
import { Button } from "../kit";
import { formatClockTime } from "../time-format";
import { useUiState } from "../ui-state";

/** The message action row under a settled answer: copy, optional extra actions (regenerate), and the recorded clock. */
export function AnswerFooter({ text, completedAt, children }: { text: string; completedAt: number | null; children?: ReactNode }) {
  const t = useT();
  const locale = useLocale();
  const timeFormat = useUiState().preferences?.timeFormat ?? "system";
  const [copy, setCopy] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs leading-5 text-muted-foreground" data-testid="answer-footer">
      <Button
        variant="ghost"
        size="sm"
        icon={copy === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
        disabled={copy === "copying"}
        aria-label={t("conversation.answer.copy")}
        onClick={() => {
          setCopy("copying");
          void window.omo.copyText(text).then(() => setCopy("copied"), () => setCopy("failed"));
        }}
      >
        {t("conversation.answer.copyShort")}
      </Button>
      {children}
      <span className="inline-flex items-center gap-1 px-1 [overflow-wrap:anywhere] data-[failed]:text-destructive-foreground" data-failed={copy === "failed" || undefined} role="status">
        {copy === "failed" && <CircleAlert className="size-3.5 shrink-0" aria-hidden />}
        {copy === "copied" ? t("conversation.answer.copied") : copy === "failed" ? t("conversation.answer.copyFailed") : ""}
      </span>
      {completedAt !== null && (
        <time className="ml-auto tabular-nums" dateTime={new Date(completedAt).toISOString()} aria-label={t("conversation.answer.completedAt")}
          data-testid="answer-completed-at">
          {formatClockTime(completedAt, timeFormat, locale)}
        </time>
      )}
    </div>
  );
}
