import type { CSSProperties } from "react";
import clsx from "clsx";
import { workspaceHue, workspaceInitials } from "./workspace-badge";

/**
 * Two-letter badge for a workspace. The hue is derived from the cwd; saturation, lightness and alpha come from the
 * palette's badge roles, so the Noir palette renders it neutral.
 */
export function WorkspaceBadge({ cwd, size = "md", className }: { cwd: string; size?: "sm" | "md"; className?: string }) {
  const hue = workspaceHue(cwd);
  const style: CSSProperties = {
    backgroundColor: `hsl(${hue} var(--dsw-omo-badge-saturation) var(--dsw-omo-badge-fill-lightness) / var(--dsw-omo-badge-fill-alpha))`,
    color: `hsl(${hue} var(--dsw-omo-badge-ink-saturation) var(--dsw-omo-badge-ink-lightness))`,
  };
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 select-none items-center justify-center rounded-sm font-mono font-bold leading-none tracking-wide",
        size === "sm" ? "size-4 text-[8px]" : "size-5 text-[9px]",
        className,
      )}
      style={style}
      aria-hidden
    >
      {workspaceInitials(cwd)}
    </span>
  );
}
