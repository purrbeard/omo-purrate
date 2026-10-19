import { useEffect, useState } from "react";
import { Check, CircleAlert, Copy, Download } from "lucide-react";
import { Button } from "../kit/Button";
import { InputError } from "../kit/Input";
import { OMO_INSTALL_COMMAND } from "../../../shared/ipc";
import type { OmoSource } from "../../../shared/ipc";
import { useT } from "../../i18n";
import { useAppSelector } from "../app-context";
import { TESTID } from "../testids";
import { InstallStatus } from "./InstallStatus";
import { useInstaller } from "./install";

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
    <main className="relative box-border flex h-full flex-col items-center overflow-y-auto bg-background px-6 pt-16 pb-10 font-sans text-foreground [word-break:keep-all] [overflow-wrap:break-word]" data-testid={TESTID.onboarding}>
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[52px]" data-window-drag />
      <div className="my-auto box-border flex w-full max-w-[560px] flex-col gap-5 rounded-xl bg-card p-8 shadow-xl">
        <span className="select-none text-xl leading-7 font-semibold tracking-[0.04em] text-primary">{t("app.brand")}</span>
        <div className="flex flex-col gap-2">
          <h1 className="m-0 text-2xl leading-8 font-medium">{t("shell.onboarding.title")}</h1>
          <p className="m-0 text-sm leading-[22px] text-muted-foreground">{t("shell.onboarding.body")}</p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-xs leading-[18px] font-medium text-muted-foreground">{t("shell.onboarding.command")}</div>
          <div className="flex items-center gap-3 rounded-md bg-muted p-2.5 pl-3.5">
            <code className="min-w-0 flex-1 font-mono text-xs leading-[18px] [font-variant-ligatures:none] [overflow-wrap:anywhere]">{command}</code>
            <Button
              size="sm"
              variant="outline"
              className="min-w-[76px]"
              icon={copyFeedback?.kind === "failed" ? <CircleAlert /> : copyFeedback?.kind === "copied" ? <Check /> : <Copy />}
              data-testid={TESTID.onboardingCopy}
              onClick={copy}
            >
              {copyLabel}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
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
            icon={<Download />}
            data-testid={TESTID.onboardingInstall}
            disabled={installing}
            onClick={installer.start}
          >
            {installing ? t("shell.onboarding.installing") : t("shell.onboarding.install")}
          </Button>
        </div>
        {check.kind === "failed" && (
          <div className="flex flex-col gap-1" role="alert">
            <InputError>{t("shell.onboarding.checkFailed", { message: "" }).replace(/:\s*$/, "")}</InputError>
            <p className="m-0 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{check.message}</p>
          </div>
        )}
        <InstallStatus installer={installer} />
        {tried.length > 0 && (
          <section className="flex flex-col gap-2 border-0 border-t border-solid border-border pt-4" aria-label={t("shell.onboarding.tried")}>
            <div className="text-xs leading-[18px] font-medium text-muted-foreground">{t("shell.onboarding.tried")}</div>
            <ul className="m-0 flex max-h-[156px] list-none flex-col gap-2.5 overflow-y-auto p-0">
              {tried.map((location, index) => (
                <li key={index} className="flex min-w-0 flex-col gap-0.5">
                  {location.path !== null && (
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <code className="min-w-0 font-mono text-xs leading-[18px] text-muted-foreground [overflow-wrap:anywhere]">{location.path}</code>
                      {location.source !== null && (
                        <span className="text-xs leading-[18px] text-muted-foreground [overflow-wrap:anywhere]">{t(`shell.settings.omo.source.${location.source}`)}</span>
                      )}
                    </span>
                  )}
                  <span className="text-xs leading-[18px] text-muted-foreground [overflow-wrap:anywhere]">{location.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
