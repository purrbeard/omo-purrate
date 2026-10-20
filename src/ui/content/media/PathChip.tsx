// A path mentioned in chat that really exists: click opens it with the OS default app, the small icons beside it show
// it in its folder or copy it. Paths that do not exist stay plain text.

import { useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { Check, Copy, FolderOpen } from "lucide-react";
import { baseName, isDangerousPath } from "../../../../shared/media";
import { useT } from "../../../i18n";
import { TESTID } from "../../testids";
import { LinkIcon, classifyLinkPath } from "../markdown/link-icon";
import { absolutePathOf } from "./path-detect";
import type { PathCandidate } from "./path-detect";
import { usePathPreview } from "./PathPreviewContext";
import { usePathInfo } from "./path-store";
import { usePathActions } from "./use-path-actions";

const SMALL_ACTION = "m-0 inline-grid size-4 shrink-0 cursor-pointer place-items-center rounded-xs border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground focus-visible:text-foreground";

/** Small icon button beside a chip. */
function ChipAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }): ReactNode {
  return (
    <button type="button" className={SMALL_ACTION} title={label} aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * The clickable form of one existing path.
 * @param props.absolute - Absolute path that was found to exist.
 * @param props.kind - Whether it is a file or a directory (directories open in the file manager).
 * @param props.label - Text shown for the path.
 * @param props.nested - Inside another button (a question option): a non-focusable span without the side actions.
 */
export function PathChip({ absolute, kind, label, nested = false }: {
  absolute: string;
  kind: "file" | "dir";
  label: string;
  nested?: boolean;
}): ReactNode {
  const t = useT();
  const actions = usePathActions();
  const [copied, setCopied] = useState(false);
  const program = kind === "file" && isDangerousPath(absolute);
  const title = `${absolute}\n${t(program ? "conversation.path.revealOnly" : kind === "dir" ? "conversation.path.openFolder" : "conversation.path.open")}`;
  const glyph = <LinkIcon kind={kind === "dir" ? "folder" : classifyLinkPath(absolute)} className="md-link-icon" />;
  if (nested) {
    return (
      <span
        role="link"
        className="md-file-mention md-file-link"
        data-testid={TESTID.pathChip}
        data-path={absolute}
        title={title}
        onClick={(event: MouseEvent) => {
          event.stopPropagation();
          actions.open(absolute);
        }}
      >
        {glyph}
        {label}
      </span>
    );
  }
  return (
    <span className="group/path inline-flex max-w-full items-baseline gap-0.5 align-baseline" data-testid={TESTID.pathChip} data-path={absolute} data-path-kind={kind}>
      <button type="button" className="md-file-mention md-file-link [overflow-wrap:anywhere]" title={title} onClick={() => actions.open(absolute)}>
        {glyph}
        {label}
      </button>
      <span className="inline-flex items-center gap-0.5 self-center opacity-0 transition-opacity group-focus-within/path:opacity-100 group-hover/path:opacity-100 motion-reduce:transition-none">
        <ChipAction label={t("conversation.path.reveal")} onClick={() => actions.reveal(absolute)}>
          <FolderOpen className="size-3" aria-hidden />
        </ChipAction>
        <ChipAction
          label={t(copied ? "conversation.path.copied" : "conversation.path.copy")}
          onClick={() => {
            void actions.copy(absolute).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
        </ChipAction>
      </span>
    </span>
  );
}

/**
 * One detected path inside text: a chip once the path is confirmed to exist, plain text before that and for prose that
 * only looks like a path.
 */
export function PathToken({ candidate, nested = false }: { candidate: PathCandidate; nested?: boolean }): ReactNode {
  const preview = usePathPreview();
  const absolute = preview === null ? null : absolutePathOf(candidate.path, preview.cwd);
  const info = usePathInfo(absolute);
  if (absolute === null || info === null || info.kind === "missing") return candidate.text;
  return <PathChip absolute={absolute} kind={info.kind} label={candidate.text} nested={nested} />;
}

/** The file name of a path, for captions. */
export function captionOf(absolute: string): string {
  return baseName(absolute);
}
