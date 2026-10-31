// Existing local paths: media opens in the shared preview dialog, other paths use the OS default app.

import { useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { Check, Copy, FolderOpen } from "lucide-react";
import { baseName, isDangerousPath, mediaKind } from "../../../../shared/media";
import { useT } from "../../../i18n";
import { TESTID } from "../../testids";
import { LinkIcon, classifyLinkPath } from "../markdown/link-icon";
import { absolutePathOf } from "./path-detect";
import type { PathCandidate } from "./path-detect";
import { usePathPreview } from "./PathPreviewContext";
import { usePathInfo } from "./path-store";
import { usePathActions } from "./use-path-actions";
import { useMediaLightbox } from "./MediaLightbox";

const SMALL_ACTION = "m-0 inline-grid size-4 shrink-0 cursor-pointer place-items-center rounded-xs border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground focus-visible:text-foreground";

function ChipAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }): ReactNode {
  return <button type="button" className={SMALL_ACTION} title={label} aria-label={label} onClick={onClick}>{children}</button>;
}

/** Existing path with the original open, reveal and copy controls. */
export function PathChip({ absolute, kind, label, nested = false }: {
  absolute: string;
  kind: "file" | "dir";
  label: string;
  nested?: boolean;
}): ReactNode {
  const t = useT();
  const actions = usePathActions();
  const lightbox = useMediaLightbox();
  const [copied, setCopied] = useState(false);
  const program = kind === "file" && isDangerousPath(absolute);
  const title = `${absolute}\n${t(program ? "conversation.path.revealOnly" : kind === "dir" ? "conversation.path.openFolder" : "conversation.path.open")}`;
  const glyph = <LinkIcon kind={kind === "dir" ? "folder" : classifyLinkPath(absolute)} className="md-link-icon" />;
  const open = (event: MouseEvent): void => {
    if (nested) event.stopPropagation();
    if (kind === "file" && mediaKind(absolute) !== null) lightbox.show(event.currentTarget, absolute);
    else actions.open(absolute);
  };
  if (nested) {
    return <>
      <span role="link" className="md-file-mention md-file-link" data-testid={TESTID.pathChip} data-path={absolute} data-path-kind={kind} title={title} onClick={open}>{glyph}{label}</span>
      {lightbox.node}
    </>;
  }
  return <>
    <span className="group/path inline-flex max-w-full items-baseline gap-0.5 align-baseline" data-testid={TESTID.pathChip} data-path={absolute} data-path-kind={kind}>
      <button type="button" className="md-file-mention md-file-link [overflow-wrap:anywhere]" title={title} onClick={open}>{glyph}{label}</button>
      <span className="inline-flex items-center gap-0.5 self-center opacity-0 transition-opacity group-focus-within/path:opacity-100 group-hover/path:opacity-100 motion-reduce:transition-none">
        <ChipAction label={t("conversation.path.reveal")} onClick={() => actions.reveal(absolute)}><FolderOpen className="size-3" aria-hidden /></ChipAction>
        <ChipAction label={t(copied ? "conversation.path.copied" : "conversation.path.copy")} onClick={() => {
          void actions.copy(absolute).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
        }}>{copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}</ChipAction>
      </span>
    </span>
    {lightbox.node}
  </>;
}

/** A candidate stays literal text until the existence check confirms it. */
export function PathToken({ candidate, nested = false }: { candidate: PathCandidate; nested?: boolean }): ReactNode {
  const preview = usePathPreview();
  const absolute = preview === null ? null : absolutePathOf(candidate.path, preview.cwd);
  const info = usePathInfo(absolute);
  if (absolute === null || info === null || info.kind === "missing") return candidate.text;
  return <PathChip absolute={absolute} kind={info.kind} label={candidate.text} nested={nested} />;
}

export function captionOf(absolute: string): string {
  return baseName(absolute);
}
