import { useEffect, useState } from "react";
import {
  Button,
  IconCheckOutlineRegular,
  IconCopyOutlineRegular,
  IconDownloadOutlineRegular,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { OMO_INSTALL_COMMAND } from "../../../shared/ipc";
import type { OmoSource } from "../../../shared/ipc";
import { useT } from "../../i18n";
import { useAppSelector } from "../app-context";
import { TESTID } from "../testids";
import { InstallStatus } from "./InstallStatus";
import { useInstaller } from "./install";
import css from "./Onboarding.module.css";

const COPY_FEEDBACK_MS = 2000;
const NOT_FOUND_PREFIX = "omo was not found. Tried: ";
const OMO_SOURCES: readonly OmoSource[] = ["override", "install.json", "local-bin", "login-path"];

interface TriedLocation {
  source: OmoSource | null;
  path: string | null;
  detail: string;
}

function isOmoSource(value: string): value is OmoSource {
  return OMO_SOURCES.some((source) => source === value);
}

/** Splits the supervisor's not-found message ("omo was not found. Tried: <source> <path>: <problem>; …") into entries; other text stays one raw entry. */
function triedLocations(message: string | null): TriedLocation[] {
  if (message === null || message.trim() === "") return [];
  const entries = message.startsWith(NOT_FOUND_PREFIX) ? message.slice(NOT_FOUND_PREFIX.length).split("; ") : [message];
  return entries.map((entry) => {
    const match = /^(\S+) (.+?): (.+)$/.exec(entry);
    const source = match?.[1];
    const path = match?.[2];
    const detail = match?.[3];
    if (source === undefined || path === undefined || detail === undefined) return { source: null, path: null, detail: entry };
    return { source: isOmoSource(source) ? source : null, path, detail };
  });
}

type CheckState = { kind: "idle" } | { kind: "running" } | { kind: "failed"; message: string };

export function Onboarding() {
  const t = useT();
  const bridge = useAppSelector((state) => state.bridge);
  const installer = useInstaller();
  const [copyFeedback, setCopyFeedback] = useState<{ kind: "copied" | "failed" } | null>(null);
  const [check, setCheck] = useState<CheckState>({ kind: "idle" });
  const command = bridge?.installCommand ?? OMO_INSTALL_COMMAND;
  const tried = triedLocations(bridge?.message ?? null);
  const installing = installer.phase.kind === "running";

  useEffect(() => {
    if (copyFeedback === null) return;
    const timer = window.setTimeout(() => setCopyFeedback(null), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  const copy = (): void => {
    window.omo.copyText(command).then(
      () => setCopyFeedback({ kind: "copied" }),
      () => setCopyFeedback({ kind: "failed" }),
    );
  };

  const checkAgain = (): void => {
    setCheck({ kind: "running" });
    window.omo.restart().then(
      () => setCheck({ kind: "idle" }),
      (error: unknown) => setCheck({ kind: "failed", message: error instanceof Error ? error.message : String(error) }),
    );
  };

  let copyLabel = t("shell.onboarding.copy");
  if (copyFeedback?.kind === "copied") copyLabel = t("shell.onboarding.copied");
  if (copyFeedback?.kind === "failed") copyLabel = t("shell.onboarding.copyFailed");

  return (
    <main className={css.root} data-testid={TESTID.onboarding}>
      <div className={css.dragBand} data-window-drag />
      <div className={css.card}>
        <span className={css.brand}>{t("app.brand")}</span>
        <div className={css.intro}>
          <h1 className={css.title}>{t("shell.onboarding.title")}</h1>
          <p className={css.body}>{t("shell.onboarding.body")}</p>
        </div>
        <div className={css.block}>
          <div className={css.label}>{t("shell.onboarding.command")}</div>
          <div className={css.commandRow}>
            <code className={css.command}>{command}</code>
            <Button
              size="sm"
              variant="outline"
              className={css.copy}
              icon={copyFeedback?.kind === "copied" ? <IconCheckOutlineRegular /> : <IconCopyOutlineRegular />}
              data-testid={TESTID.onboardingCopy}
              onClick={copy}
            >
              {copyLabel}
            </Button>
          </div>
        </div>
        <div className={css.actions}>
          <Button
            variant="outline"
            data-testid={TESTID.onboardingRetry}
            disabled={check.kind === "running" || installing}
            onClick={checkAgain}
          >
            {check.kind === "running" ? t("shell.onboarding.checking") : t("shell.onboarding.checkAgain")}
          </Button>
          <Button
            variant="primary"
            icon={<IconDownloadOutlineRegular />}
            data-testid={TESTID.onboardingInstall}
            disabled={installing}
            onClick={installer.start}
          >
            {installing ? t("shell.onboarding.installing") : t("shell.onboarding.install")}
          </Button>
        </div>
        {check.kind === "failed" && (
          <p className={css.error} role="alert">
            {t("shell.onboarding.checkFailed", { message: check.message })}
          </p>
        )}
        <InstallStatus installer={installer} />
        {tried.length > 0 && (
          <section className={css.tried} aria-label={t("shell.onboarding.tried")}>
            <div className={css.label}>{t("shell.onboarding.tried")}</div>
            <ul className={css.triedList}>
              {tried.map((location, index) => (
                <li key={index} className={css.triedItem}>
                  {location.path !== null && (
                    <span className={css.triedHead}>
                      <code className={css.triedPath}>{location.path}</code>
                      {location.source !== null && (
                        <span className={css.triedSource}>{t(`shell.settings.omo.source.${location.source}`)}</span>
                      )}
                    </span>
                  )}
                  <span className={css.triedDetail}>{location.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
