// Inline previews of the existing local images and videos a message references: thumbnails that open a lightbox, and
// native video players. Each preview is captioned with its file name, which is the clickable path.

import { useState } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import { baseName, mediaKind, mediaUrl } from "../../../../shared/media";
import { useT } from "../../../i18n";
import { TESTID } from "../../testids";
import { PathChip } from "./PathChip";
import { MEDIA_IMAGE_ATTR, MEDIA_PATH_ATTR, useMediaLightbox } from "./MediaLightbox";
import { absolutePathOf } from "./path-detect";
import { usePathPreview } from "./PathPreviewContext";
import { usePathInfo } from "./path-store";

function ImageItem({ absolute, compact }: { absolute: string; compact: boolean }): ReactNode {
  const t = useT();
  const lightbox = useMediaLightbox();
  const [failed, setFailed] = useState(false);
  const name = baseName(absolute);
  if (failed) return <span className="text-xs text-muted-foreground">{t("conversation.media.failed", { name })}</span>;
  return (
    <>
      <button
        type="button"
        className="m-0 block max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-solid border-border bg-card p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        {...{ [MEDIA_IMAGE_ATTR]: "", [MEDIA_PATH_ATTR]: absolute }}
        aria-label={t("conversation.media.zoom", { name })}
        onClick={(event) => lightbox.show(event.currentTarget, absolute)}
      >
        <img
          data-testid={TESTID.mediaThumb}
          src={mediaUrl(absolute)}
          alt={t("conversation.media.image", { name })}
          loading="lazy"
          decoding="async"
          draggable={false}
          style={{ maxHeight: compact ? 120 : 360 }}
          className="block h-auto w-auto max-w-full object-contain"
          onError={() => setFailed(true)}
        />
      </button>
      {lightbox.node}
    </>
  );
}

function VideoItem({ absolute, compact }: { absolute: string; compact: boolean }): ReactNode {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const name = baseName(absolute);
  return (
    <>
    <video
      data-testid={TESTID.mediaVideo}
      src={mediaUrl(absolute)}
      controls
      preload="metadata"
      aria-label={t("conversation.media.video", { name })}
      style={{ maxHeight: compact ? 160 : 360 }}
      className="block h-auto w-auto max-w-full rounded-lg border border-solid border-border bg-black"
      onError={() => setFailed(true)}
    />
    {failed && <span className="text-xs text-muted-foreground">{t("conversation.media.failed", { name })}</span>}
    </>
  );
}

/** One preview, rendered only once the path is known to be an existing file. */
function MediaItem({ raw, compact }: { raw: string; compact: boolean }): ReactNode {
  const preview = usePathPreview();
  const absolute = preview === null ? null : absolutePathOf(raw, preview.cwd);
  const info = usePathInfo(absolute);
  const kind = mediaKind(raw);
  if (absolute === null || kind === null || info?.kind !== "file") return null;
  return (
    <figure className="m-0 flex min-w-0 max-w-full flex-col items-start gap-1" data-testid={TESTID.mediaItem} data-media-kind={kind} data-media-path={absolute}>
      {kind === "image" ? <ImageItem absolute={absolute} compact={compact} /> : <VideoItem absolute={absolute} compact={compact} />}
      <figcaption className="max-w-full text-xs leading-4 text-muted-foreground">
        <PathChip absolute={absolute} kind="file" label={baseName(absolute)} />
      </figcaption>
    </figure>
  );
}

/**
 * Previews for the media among `paths`; renders nothing until a path is confirmed to exist.
 * @param props.paths - Raw absolute or workspace-relative paths; duplicates collapse.
 * @param props.compact - Smaller previews (question cards).
 * @param props.className - Extra classes for the strip.
 */
export function MediaStrip({ paths, compact = false, className }: { paths: readonly string[]; compact?: boolean; className?: string }): ReactNode {
  const unique = [...new Set(paths)];
  return (
    <div className={clsx("mt-2 flex min-w-0 flex-wrap items-start gap-3 whitespace-normal empty:hidden", className)} data-media-strip="">
      {unique.map((raw) => <MediaItem key={raw} raw={raw} compact={compact} />)}
    </div>
  );
}
