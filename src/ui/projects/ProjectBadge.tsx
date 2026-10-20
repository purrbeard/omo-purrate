import clsx from "clsx";
import { PROJECT_COLORS, PROJECT_ICONS } from "../../../shared/project-settings";
import { useUiState } from "../ui-state";
import { workspaceInitials } from "../sidebar/workspace-badge";
import { WorkspaceBadge } from "../sidebar/WorkspaceBadge";
import { PROJECT_ICON_COMPONENTS, findProjectSetting, projectColorStyle } from "./project-style";

/** A project's badge: the user's icon and color when set, otherwise the derived initials badge of the sidebar. */
export function ProjectBadge({ cwd, size = "md", className }: { cwd: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const { preferences } = useUiState();
  const setting = findProjectSetting(preferences?.projectSettings, cwd)?.setting;
  const icon = PROJECT_ICONS.find((candidate) => candidate === setting?.icon);
  const color = PROJECT_COLORS.find((candidate) => candidate === setting?.color);
  if (icon === undefined && color === undefined) return <WorkspaceBadge cwd={cwd} size={size === "lg" ? "md" : size} className={clsx(size === "lg" && "size-9 text-sm", className)} />;
  const Icon = icon === undefined ? null : PROJECT_ICON_COMPONENTS[icon];
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 select-none items-center justify-center rounded-sm font-mono font-bold leading-none tracking-wide",
        size === "sm" ? "size-4 text-[8px]" : size === "md" ? "size-5 text-[9px]" : "size-9 text-sm",
        color === undefined && "bg-muted text-foreground",
        className,
      )}
      style={color === undefined ? undefined : projectColorStyle(color)}
      data-project-icon={icon}
      data-project-color={color}
      aria-hidden
    >
      {Icon === null ? workspaceInitials(cwd) : <Icon className={size === "sm" ? "size-3" : size === "md" ? "size-3.5" : "size-5"} />}
    </span>
  );
}
