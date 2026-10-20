import { Lock } from "lucide-react";
import { useT } from "../../i18n";
import { describeHolder } from "../../../shared/session-held";
import type { SessionHolder } from "../../../shared/session-held";
import { useActions } from "../app-context";
import { Button } from "../kit";
import { TESTID } from "../testids";

/** Explains why the composer is locked: another omo process holds the session. The history above stays readable. */
export function HeldBanner({ threadId, holders }: { threadId: string; holders: readonly SessionHolder[] }) {
  const t = useT();
  const actions = useActions();
  return (
    <div className="mx-3 flex flex-wrap items-center gap-2 text-[13px] leading-5 text-muted-foreground" role="alert" data-testid={TESTID.composerHeldBanner}>
      <Lock className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t("composer.held.message", { holders: holders.map(describeHolder).join("; ") })}</span>
      <Button variant="outline" size="sm" data-testid={TESTID.composerHeldRetry} onClick={() => void actions.retryHeldThread(threadId)}>{t("composer.held.retry")}</Button>
    </div>
  );
}
