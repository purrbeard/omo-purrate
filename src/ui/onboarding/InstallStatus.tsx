import { useLayoutEffect, useRef } from "react";
import { CircleCheck, LoaderCircle } from "lucide-react";
import { InputError } from "../kit/Input";
import { useT } from "../../i18n";
import { TESTID } from "../testids";
import type { Installer } from "./install";

export function InstallStatus({ installer }: { installer: Installer }) {
  const t = useT();
  const log = useRef<HTMLPreElement>(null);
  const { phase, lines } = installer;

  useLayoutEffect(() => {
    const element = log.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [lines]);

  if (phase.kind === "idle") return null;

  let summary;
  switch (phase.kind) {
    case "running":
      summary = (
        <p className="m-0 flex items-center gap-2 text-[13px] leading-5 text-muted-foreground" role="status">
          <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
          {t("shell.install.running")}
        </p>
      );
      break;
    case "succeeded":
      summary = (
        <p className="m-0 flex items-center gap-2 text-[13px] leading-5 text-muted-foreground" role="status">
          <CircleCheck aria-hidden="true" className="size-3.5 shrink-0 text-success" />
          {t("shell.install.succeeded")}
        </p>
      );
      break;
    case "failed":
      summary = (
        <div className="flex flex-col gap-1" data-tone="error" role="alert">
          <InputError>{phase.exitCode !== null
            ? t("shell.install.failed", { code: phase.exitCode })
            : t("shell.install.failedMessage", { message: "" }).replace(/:\s*$/, "")}</InputError>
          {phase.exitCode === null && phase.message !== null && (
            <p className="m-0 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{phase.message}</p>
          )}
        </div>
      );
      break;
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <pre ref={log} className="m-0 box-border max-h-[180px] min-h-12 overflow-auto rounded-sm bg-muted px-3 py-2.5 font-mono text-[11px] leading-4 whitespace-pre-wrap text-muted-foreground [font-variant-ligatures:none] [overflow-wrap:anywhere]" role="log" aria-label={t("shell.install.log")} data-testid={TESTID.installLog}>
        {lines.map((line, index) => (
          <span key={index} data-stream={line.stream} className={line.stream === "stderr" ? "text-warning" : undefined}>
            {line.text}
            {"\n"}
          </span>
        ))}
      </pre>
      {summary}
    </div>
  );
}
