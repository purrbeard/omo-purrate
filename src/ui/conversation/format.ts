import { relativizeToCwd, workspaceTitleOf } from "@deepseek-ai/dsh-util-workspace-path";
import type { Translate } from "../../i18n";
import type { ThreadSummary } from "../../state";
import { projectTitleText } from "./skill-text";

export function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return (newline < 0 ? text : text.slice(0, newline)).trim();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Thread title: the name, else the preview, each projected by projectTitleText; else `fallback`. */
export function threadTitle(thread: ThreadSummary | null, fallback: string): string {
  const name = projectTitleText(thread?.name ?? "");
  if (name !== "") return name;
  const preview = projectTitleText(thread?.preview ?? "");
  return preview === "" ? fallback : preview;
}

export function workspaceName(cwd: string): string {
  const name = workspaceTitleOf(cwd);
  return name === "" ? cwd : name;
}

export function displayPath(path: string, cwd: string | null): string {
  return relativizeToCwd(path, cwd ?? undefined);
}

export function formatWholeSeconds(ms: number, t: Translate): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return t("conversation.duration.s", { value: seconds });
  return t("conversation.duration.m", { minutes: Math.floor(seconds / 60), seconds: seconds % 60 });
}

export function formatDuration(ms: number, t: Translate): string {
  if (ms < 1000) return t("conversation.duration.ms", { value: Math.max(0, Math.round(ms)) });
  const tenths = Math.round(ms / 100);
  if (tenths < 100) return t("conversation.duration.s", { value: (tenths / 10).toFixed(1) });
  return formatWholeSeconds(ms, t);
}

export function elapsedMs(startedAtMs: number | null, completedAtMs: number | null): number | null {
  return startedAtMs === null || completedAtMs === null ? null : Math.max(0, completedAtMs - startedAtMs);
}
