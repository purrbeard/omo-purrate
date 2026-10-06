import { useState } from "react";
import clsx from "clsx";
import {
  Button,
  IconChevronDownOutlineRegular,
  IconRefreshOutlineRegular,
  StateDot,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { BridgeState, BridgeStatus } from "../../../shared/ipc";
import { useT } from "../../i18n";
import type { Translate } from "../../i18n";
import { useAppSelector } from "../app-context";
import { TESTID } from "../testids";
import css from "./ConnectionBanner.module.css";

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
      className={css.root}
      role={busy ? "status" : "alert"}
      data-testid={TESTID.connectionBanner}
      data-state={state}
    >
      <div className={css.row}>
        <StateDot state={busy ? "ongoing" : "error"} className={css.dot} />
        <span className={css.text}>{bannerText(state, bridge, t)}</span>
        {details !== null && (
          <button
            type="button"
            className={css.disclosure}
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {t("shell.banner.details")}
            <IconChevronDownOutlineRegular size={12} className={clsx(css.chevron, detailsOpen && css.chevronOpen)} />
          </button>
        )}
        {!busy && (
          <Button
            size="sm"
            variant="outline"
            className={css.restart}
            icon={<IconRefreshOutlineRegular />}
            data-testid={TESTID.restartOmo}
            onClick={restart}
          >
            {t("shell.banner.restart")}
          </Button>
        )}
      </div>
      {detailsOpen && details !== null && <pre className={css.details}>{details}</pre>}
      {restartError !== null && (
        <p className={css.error}>{t("shell.banner.restartFailed", { message: restartError })}</p>
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
