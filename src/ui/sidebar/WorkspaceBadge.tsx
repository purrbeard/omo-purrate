import type { CSSProperties } from "react";
import clsx from "clsx";
import { workspaceHue, workspaceInitials } from "./workspace-badge";
import css from "./WorkspaceBadge.module.css";

/** Colored two-letter badge for a workspace; the hue is derived from the cwd and handed to the theme tokens through `--dsh-badge-hue`. */
export function WorkspaceBadge({ cwd, size = "md", className }: { cwd: string; size?: "sm" | "md"; className?: string }) {
  const style = { "--dsh-badge-hue": String(workspaceHue(cwd)) } as CSSProperties;
  return (
    <span className={clsx(css.badge, size === "sm" && css.small, className)} style={style} aria-hidden>
      {workspaceInitials(cwd)}
    </span>
  );
}
