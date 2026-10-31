import { useRef, useState } from "react";
import { useT } from "../../i18n";
import { Button } from "../kit";
import { errorMessage } from "../settings/diagnostics";
import { useSessionRuntime } from "./use-session-runtime";

export function PausedBanner({ threadId }: { threadId: string }) {
  const t = useT();
  const { runtime, refresh } = useSessionRuntime(threadId);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const effect = useRef<string | null>(null);
  const resume = async (): Promise<void> => {
    if (runtime === null || busy) return;
    setBusy(true);
    setFailure(null);
    effect.current ??= crypto.randomUUID();
    try {
      const result = await window.omo.request("thread/execution/resume", { threadId, effectId: effect.current,
        ...(runtime.pauseSeq === null ? {} : { expectedSeq: runtime.pauseSeq }) });
      effect.current = null;
      if (!result.resumed && result.reason !== "not_paused") setFailure(t(result.reason === "resume_through_parent" ? "composer.paused.parent" : "composer.paused.stale"));
    } catch (reason) { setFailure(errorMessage(reason)); }
    finally { setBusy(false); refresh(); }
  };
  if (!runtime?.paused && failure === null) return null;
  return <div className="mx-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="session-paused-banner" role="status">
    <span className="min-w-0 flex-1 wrap-anywhere">{failure ?? t("composer.paused.hint", { notices: runtime?.noticeCount ?? 0, inputs: runtime?.heldInputCount ?? 0 })}</span>
    <Button size="sm" variant="outline" data-testid="session-resume" disabled={busy || !runtime?.paused} onClick={() => void resume()}>{t("composer.paused.resume")}</Button>
  </div>;
}
