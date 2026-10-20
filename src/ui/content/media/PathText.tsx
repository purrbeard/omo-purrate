// Plain text with its paths made clickable and its media previewed. Used for text the Markdown renderer does not own:
// question cards, user bubbles, tool output.

import { Fragment, useMemo } from "react";
import type { ReactNode } from "react";
import { mediaKind } from "../../../../shared/media";
import { MediaStrip } from "./MediaStrip";
import { PathToken } from "./PathChip";
import { findPathCandidates } from "./path-detect";
import type { PathCandidate } from "./path-detect";
import { usePathPreview } from "./PathPreviewContext";

/**
 * Split `text` around its candidates: strings stay strings, candidates become tokens.
 * @param text - The source text.
 * @param candidates - Candidates found in `text`, in order.
 * @param nested - Render tokens as non-focusable spans (inside a button).
 */
export function renderPathSegments(text: string, candidates: readonly PathCandidate[], nested = false): ReactNode[] {
  const out: ReactNode[] = [];
  let cursor = 0;
  for (const candidate of candidates) {
    if (candidate.start > cursor) out.push(text.slice(cursor, candidate.start));
    out.push(<PathToken key={candidate.start} candidate={candidate} nested={nested} />);
    cursor = candidate.end;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

/** The text with its paths as chips (no previews). Plain text outside a preview scope. */
export function PathInline({ text, nested = false }: { text: string; nested?: boolean }): ReactNode {
  const enabled = usePathPreview() !== null;
  const candidates = useMemo(() => (enabled ? findPathCandidates(text) : []), [enabled, text]);
  if (candidates.length === 0) return text;
  return <Fragment>{renderPathSegments(text, candidates, nested)}</Fragment>;
}

/** Previews of the existing images and videos `text` mentions; nothing outside a preview scope. */
export function PathPreviews({ text, compact = false, className }: { text: string; compact?: boolean; className?: string }): ReactNode {
  const enabled = usePathPreview() !== null;
  const media = useMemo(
    () => (enabled ? findPathCandidates(text).filter((candidate) => mediaKind(candidate.path) !== null).map((candidate) => candidate.path) : []),
    [enabled, text],
  );
  if (media.length === 0) return null;
  return <MediaStrip paths={media} compact={compact} className={className} />;
}

/** Text with clickable paths and, unless disabled, inline media previews under it. */
export function PathText({ text, previews = true, compact = false }: { text: string; previews?: boolean; compact?: boolean }): ReactNode {
  return (
    <>
      <PathInline text={text} />
      {previews && <PathPreviews text={text} compact={compact} />}
    </>
  );
}
