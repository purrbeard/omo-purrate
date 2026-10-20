// Full-size image preview. Items are gathered from the thumbnails of the same message (or question), so the arrow
// keys move between the images that message references.

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, FolderOpen, X } from "lucide-react";
import { baseName, mediaUrl } from "../../../../shared/media";
import { useT } from "../../../i18n";
import { Dialog, IconButton } from "../../kit";
import { TESTID } from "../../testids";
import { usePathActions } from "./use-path-actions";

/** Attributes the thumbnails carry so the gallery can be collected from the DOM at open time. */
export const MEDIA_IMAGE_ATTR = "data-media-image";
export const MEDIA_PATH_ATTR = "data-media-path";
/** Marks the root of a message or question whose images form one gallery. */
export const MEDIA_SCOPE_ATTR = "data-media-scope";

interface Gallery {
  paths: readonly string[];
  index: number;
}

/** Image paths in the scope around `origin`, in document order, without repeats. */
function collectImages(origin: Element): string[] {
  const scope = origin.closest(`[${MEDIA_SCOPE_ATTR}]`) ?? document.body;
  const paths: string[] = [];
  for (const element of scope.querySelectorAll(`[${MEDIA_IMAGE_ATTR}]`)) {
    const path = element.getAttribute(MEDIA_PATH_ATTR);
    if (path !== null && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

function Lightbox({ gallery, onIndex, onClose }: { gallery: Gallery; onIndex: (index: number) => void; onClose: () => void }): ReactNode {
  const t = useT();
  const actions = usePathActions();
  const [copied, setCopied] = useState(false);
  const { paths, index } = gallery;
  const path = paths[index] ?? "";
  const name = baseName(path);
  const step = useCallback((delta: number) => {
    if (paths.length > 1) onIndex((index + delta + paths.length) % paths.length);
  }, [index, onIndex, paths.length]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
      else return;
      event.preventDefault();
    };
    // Capture phase: arrows keep working whichever dialog control has focus.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [step]);
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content className="w-fit max-w-[min(94vw,1280px)] items-stretch gap-3 p-4" data-testid={TESTID.mediaLightbox}>
        <div className="flex min-w-0 items-center gap-2">
          <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-medium" title={path}>{name}</Dialog.Title>
          {paths.length > 1 && (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t("conversation.media.counter", { index: index + 1, total: paths.length })}</span>
          )}
          <IconButton icon={<ExternalLink aria-hidden />} label={t("conversation.path.open")} data-testid={TESTID.mediaLightboxOpen} onClick={() => actions.open(path)} />
          <IconButton icon={<FolderOpen aria-hidden />} label={t("conversation.path.reveal")} data-testid={TESTID.mediaLightboxReveal} onClick={() => actions.reveal(path)} />
          <IconButton
            icon={copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            label={t(copied ? "conversation.path.copied" : "conversation.path.copy")}
            data-testid={TESTID.mediaLightboxCopy}
            onClick={() => { void actions.copy(path).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
          />
          <Dialog.Close variant="ghost" aria-label={t("conversation.media.close")} data-testid={TESTID.mediaLightboxClose} className="size-9 shrink-0 p-0">
            <X className="size-4" aria-hidden />
          </Dialog.Close>
        </div>
        <div className="relative flex min-h-0 items-center justify-center">
          <img
            key={path}
            src={mediaUrl(path)}
            alt={name}
            data-testid={TESTID.mediaLightboxImage}
            className="block max-h-[75dvh] max-w-full rounded-md object-contain"
          />
          {paths.length > 1 && (
            <>
              <IconButton
                className="absolute top-1/2 left-1 -translate-y-1/2 bg-popover/80"
                icon={<ChevronLeft aria-hidden />}
                label={t("conversation.media.prev")}
                data-testid={TESTID.mediaLightboxPrev}
                onClick={() => step(-1)}
              />
              <IconButton
                className="absolute top-1/2 right-1 -translate-y-1/2 bg-popover/80"
                icon={<ChevronRight aria-hidden />}
                label={t("conversation.media.next")}
                data-testid={TESTID.mediaLightboxNext}
                onClick={() => step(1)}
              />
            </>
          )}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * Lightbox state for a thumbnail.
 * @returns `show(origin, path)` to open the gallery around the thumbnail element, and `node` to render once.
 */
export function useMediaLightbox(): { show: (origin: Element, path: string) => void; node: ReactNode } {
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const show = useCallback((origin: Element, path: string): void => {
    const paths = collectImages(origin);
    if (!paths.includes(path)) paths.push(path);
    setGallery({ paths, index: paths.indexOf(path) });
  }, []);
  const node = gallery === null ? null : (
    <Lightbox gallery={gallery} onIndex={(index) => setGallery({ paths: gallery.paths, index })} onClose={() => setGallery(null)} />
  );
  return { show, node };
}
