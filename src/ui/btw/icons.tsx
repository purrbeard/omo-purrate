interface GlyphProps {
  size?: number;
}

export function SparkIcon({ size = 14 }: GlyphProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden>
      <path d="M7 1.5C7.4 4.6 9.4 6.6 12.5 7C9.4 7.4 7.4 9.4 7 12.5C6.6 9.4 4.6 7.4 1.5 7C4.6 6.6 6.6 4.6 7 1.5Z" fill="currentColor" />
      <path d="M12.8 9.6C12.9 10.6 13.6 11.3 14.6 11.4C13.6 11.5 12.9 12.2 12.8 13.2C12.7 12.2 12 11.5 11 11.4C12 11.3 12.7 10.6 12.8 9.6Z" fill="currentColor" />
    </svg>
  );
}

export function CloseIcon({ size = 14 }: GlyphProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function PlusIcon({ size = 14 }: GlyphProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function BubbleIcon({ size = 14 }: GlyphProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden>
      <path
        d="M3 3h10a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 13 11H8.2L5 13.5V11H3a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 3 3Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function SendIcon({ size = 14 }: GlyphProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden>
      <path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function StopIcon({ size = 12 }: GlyphProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden>
      <rect x="3" y="3" width="10" height="10" rx="2.5" fill="currentColor" />
    </svg>
  );
}
