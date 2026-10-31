// Full-size media preview using the existing message gallery and dialog controls.

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, FolderOpen, X } from "lucide-react";
import { baseName, mediaKind, mediaUrl } from "../../../../shared/media";
import { useT } from "../../../i18n";
import { Dialog, IconButton } from "../../kit";
import { TESTID } from "../../testids";
import { usePathActions } from "./use-path-actions";

export const MEDIA_IMAGE_ATTR = "data-media-image";
export const MEDIA_PATH_ATTR = "data-media-path";
export const MEDIA_SCOPE_ATTR = "data-media-scope";

interface Gallery {
  paths: readonly string[];
  index: number;
}

/** Existing media in the surrounding message, in document order, without repeats. */
function collectImages(origin: Element): string[] {
  const scope = origin.closest(`[${MEDIA_SCOPE_ATTR}], [data-flow], [data-testid="side-question"]`) ?? origin.parentElement ?? origin;
  const paths: string[] = [];
  for (const element of scope.querySelectorAll(`[${MEDIA_PATH_ATTR}], [data-path-kind="file"][data-path]`)) {
    const path = element.getAttribute(MEDIA_PATH_ATTR) ?? element.getAttribute("data-path");
    if (path !== null && mediaKind(path) !== null && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

function Lightbox({ gallery, onIndex, onClose }: { gallery: Gallery; onIndex: (index: number) => void; onClose: () => void }): ReactNode {
  const t = useT();
  const actions = usePathActions();
  const [copied, setCopied] = useState(false);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const { paths, index } = gallery;
  const path = paths[index] ?? "";
  const name = baseName(path);
  const step = useCallback((delta: number) => {
    if (paths.length > 1) onIndex((index + delta + paths.length) % paths.length);
  }, [index, onIndex, paths.length]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Native video controls own their seek keys.
      if (event.target instanceof HTMLVideoElement) return;
      if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [step]);
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content className="w-fit max-w-[min(94vw,1280px)] items-stretch gap-3 p-4" data-testid={TESTID.mediaLightbox}>
        <div className="flex min-w-0 items-center gap-2">
          <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-medium" title={path}>{name}</Dialog.Title>
          {paths.length > 1 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t("conversation.media.counter", { index: index + 1, total: paths.length })}</span>}
          <IconButton icon={<ExternalLink aria-hidden />} label={t("conversation.path.open")} data-testid={TESTID.mediaLightboxOpen} onClick={() => actions.open(path)} />
          <IconButton icon={<FolderOpen aria-hidden />} label={t("conversation.path.reveal")} data-testid={TESTID.mediaLightboxReveal} onClick={() => actions.reveal(path)} />
          <IconButton icon={copied ? <Check aria-hidden /> : <Copy aria-hidden />} label={t(copied ? "conversation.path.copied" : "conversation.path.copy")} data-testid={TESTID.mediaLightboxCopy}
            onClick={() => { void actions.copy(path).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }} />
          <Dialog.Close variant="ghost" aria-label={t("conversation.media.close")} data-testid={TESTID.mediaLightboxClose} className="size-9 shrink-0 p-0"><X className="size-4" aria-hidden /></Dialog.Close>
        </div>
        <div className="relative flex min-h-0 items-center justify-center">
          {failedPath === path ? (
            <span role="alert" className="text-sm text-muted-foreground">{t("conversation.media.failed", { name })}</span>
          ) : mediaKind(path) === "video" ? (
            <video key={path} src={mediaUrl(path)} controls playsInline preload="metadata" aria-label={t("conversation.media.video", { name })}
              data-testid={TESTID.mediaVideo} className="block max-h-[75dvh] max-w-full rounded-md bg-black object-contain" onError={() => setFailedPath(path)} />
          ) : (
            <img key={path} src={mediaUrl(path)} alt={name} data-testid={TESTID.mediaLightboxImage}
              className="block max-h-[75dvh] max-w-full rounded-md object-contain" onError={() => setFailedPath(path)} />
          )}
          {paths.length > 1 && <>
            <IconButton className="absolute top-1/2 left-1 -translate-y-1/2 bg-popover/80" icon={<ChevronLeft aria-hidden />} label={t("conversation.media.prev")} data-testid={TESTID.mediaLightboxPrev} onClick={() => step(-1)} />
            <IconButton className="absolute top-1/2 right-1 -translate-y-1/2 bg-popover/80" icon={<ChevronRight aria-hidden />} label={t("conversation.media.next")} data-testid={TESTID.mediaLightboxNext} onClick={() => step(1)} />
          </>}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** Open the existing media dialog around the clicked path or thumbnail. */
export function useMediaLightbox(): { show: (origin: Element, path: string) => void; node: ReactNode } {
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const show = useCallback((origin: Element, path: string): void => {
    const paths = collectImages(origin);
    if (!paths.includes(path)) paths.push(path);
    setGallery({ paths, index: paths.indexOf(path) });
  }, []);
  const node = gallery === null ? null : <Lightbox gallery={gallery} onIndex={(index) => setGallery({ paths: gallery.paths, index })} onClose={() => setGallery(null)} />;
  return { show, node };
}
