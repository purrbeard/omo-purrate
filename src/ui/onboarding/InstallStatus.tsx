import { useLayoutEffect, useRef } from "react";
import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import { useT } from "../../i18n";
import { TESTID } from "../testids";
import type { Installer } from "./install";
import css from "./InstallStatus.module.css";

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
        <p className={css.summary} role="status">
          <StateDot state="ongoing" />
          {t("shell.install.running")}
        </p>
      );
      break;
    case "succeeded":
      summary = (
        <p className={css.summary} role="status">
          <StateDot state="done" />
          {t("shell.install.succeeded")}
        </p>
      );
      break;
    case "failed":
      summary = (
        <p className={css.summary} data-tone="error" role="alert">
          <StateDot state="error" />
          {phase.exitCode !== null
            ? t("shell.install.failed", { code: phase.exitCode })
            : t("shell.install.failedMessage", { message: phase.message ?? "" })}
        </p>
      );
      break;
  }

  return (
    <div className={css.root}>
      <pre ref={log} className={css.log} role="log" aria-label={t("shell.install.log")} data-testid={TESTID.installLog}>
        {lines.map((line, index) => (
          <span key={index} data-stream={line.stream}>
            {line.text}
            {"\n"}
          </span>
        ))}
      </pre>
      {summary}
    </div>
  );
}
