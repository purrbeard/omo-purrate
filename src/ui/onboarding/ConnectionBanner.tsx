import { useState } from "react";
import clsx from "clsx";
import { ChevronDown, CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "../kit/Button";
import { InputError } from "../kit/Input";
import type { BridgeState, BridgeStatus } from "../../../shared/ipc";
import { useT } from "../../i18n";
import type { Translate } from "../../i18n";
import { useAppSelector } from "../app-context";
import { TESTID } from "../testids";

type VisibleState = Exclude<BridgeState, "connected">;

function isBusy(state: VisibleState): boolean {
  return state === "locating" || state === "starting" || state === "restarting";
}

function bannerText(state: VisibleState, bridge: BridgeStatus, t: Translate): string {
  switch (state) {
    case "locating":
    case "starting":
      // The launch-time update runs between locating omo and starting it.
      if (bridge.update?.state === "checking") return t("shell.banner.checkingUpdate");
      if (bridge.update?.state === "installing") return t("shell.banner.installingUpdate");
      return t("shell.banner.starting");
    case "restarting":
      return t("shell.banner.reconnecting", { attempt: bridge.restartAttempt });
    case "not-found":
      return t("shell.banner.notFound");
    case "exited":
    case "stopped":
      return bridge.exitCode === null
        ? t("shell.banner.stopped")
        : t("shell.banner.stoppedWithCode", { code: bridge.exitCode });
  }
}

function failureDetails(bridge: BridgeStatus): string | null {
  const tail = bridge.stderrTail?.trim() ?? "";
  if (tail !== "") return tail;
  const message = bridge.message?.trim() ?? "";
  return message === "" ? null : message;
}

function BannerBody({ state, bridge }: { state: VisibleState; bridge: BridgeStatus }) {
  const t = useT();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const busy = isBusy(state);
  const details = busy ? null : failureDetails(bridge);

  const restart = (): void => {
    setRestartError(null);
    window.omo.restart().catch((error: unknown) => {
      setRestartError(error instanceof Error ? error.message : String(error));
    });
  };

  return (
    <div
      className={clsx("absolute top-[calc(var(--dsh-frame-top-clearance,0px)+12px)] inset-x-6 z-30 mx-auto box-border flex w-fit max-w-[min(560px,calc(100%_-_48px))] flex-col gap-2 rounded-lg bg-popover py-1.5 pl-3.5 text-[13px] leading-5 text-popover-foreground shadow-xl [word-break:keep-all] [overflow-wrap:break-word]", busy ? "pr-3.5" : "pr-1.5")}
      role={busy ? "status" : "alert"}
      data-testid={TESTID.connectionBanner}
      data-state={state}
    >
      <div className="flex min-h-7 items-center gap-2.5">
        {busy ? <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" /> : <CircleAlert aria-hidden="true" className="size-3.5 shrink-0 text-destructive-foreground" />}
        <span className="min-w-0 flex-auto">{bannerText(state, bridge, t)}</span>
        {details !== null && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {t("shell.banner.details")}
            <ChevronDown aria-hidden="true" className={clsx("transition-transform duration-150 motion-reduce:transition-none", detailsOpen && "rotate-180")} />
          </Button>
        )}
        {!busy && (
          <Button
            size="sm"
            variant="outline"
            icon={<RefreshCw />}
            data-testid={TESTID.restartOmo}
            onClick={restart}
          >
            {t("shell.banner.restart")}
          </Button>
        )}
      </div>
      {detailsOpen && details !== null && <pre className="mt-0 mr-2 mb-1 ml-0 max-h-[200px] overflow-auto rounded-sm bg-muted px-2.5 py-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-muted-foreground [font-variant-ligatures:none] [overflow-wrap:anywhere]">{details}</pre>}
      {restartError !== null && (
        <div className="mr-2 mb-1 flex flex-col gap-1">
          <InputError>{t("shell.banner.restartFailed", { message: "" }).replace(/:\s*$/, "")}</InputError>
          <p className="m-0 text-xs leading-[18px] text-muted-foreground [overflow-wrap:anywhere]">{restartError}</p>
        </div>
      )}
    </div>
  );
}

export function ConnectionBanner() {
  const bridge = useAppSelector((state) => state.bridge);
  if (bridge === null || bridge.state === "connected") return null;
  const state = bridge.state;
  return <BannerBody key={isBusy(state) ? "busy" : "failure"} state={state} bridge={bridge} />;
}
