// ImagePreview: a passive, contained image with loading and failure status. It adds no
// activation target of its own, so it can sit inside a link or card.

import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'

export interface ImagePreviewProps {
  src: string
  alt: string
  loadingLabel: string
  failedLabel: string
}

/**
 * Render a contained preview; a new `src` restarts the loading state.
 * @param props - source, accessible description and localized status.
 * @returns a fixed-height frame with the image or its status.
 */
export function ImagePreview(props: ImagePreviewProps) {
  return <Preview key={props.src} {...props} />
}

function Preview({ src, alt, loadingLabel, failedLabel }: ImagePreviewProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  return (
    <span className="relative grid h-[180px] w-full place-items-center overflow-hidden rounded-[var(--dsw-radius-sm)] bg-background">
      {state !== 'failed' && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-full min-h-0 object-contain opacity-0 data-ready:opacity-100"
          data-ready={state === 'ready' || undefined}
          onLoad={() => { setState('ready') }}
          onError={() => { setState('failed') }}
        />
      )}
      {state !== 'ready' && (
        <span className="absolute inset-0 flex items-center justify-center gap-2 p-3 text-xs leading-[18px] text-muted-foreground" role="status">
          {state === 'loading' && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
          <span>{state === 'loading' ? loadingLabel : failedLabel}</span>
        </span>
      )}
    </span>
  )
}
