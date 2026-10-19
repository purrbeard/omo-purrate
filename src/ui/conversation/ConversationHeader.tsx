import { memo, type ReactNode } from "react";
import { IconPanelLeftOutlineRegular, StateDot, TextShimmer, Tooltip } from "@deepseek-ai/dsh-client-ui-primitives";
import { useT } from "../../i18n";
import type { ThreadSummary } from "../../state";
import { WorkspaceBadge } from "../sidebar/WorkspaceBadge";
import { TESTID } from "../testids";
import { shownTab, uiState, useUiState } from "../ui-state";
import { threadTitle, workspaceName } from "./format";
import { OpenButton } from "./OpenButton";
import { CommitPushButton } from "./CommitPushButton";
import clsx from "clsx";
import { focusRing } from "../kit";

const headerButton = clsx("m-0 -ml-1 inline-flex size-7 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground motion-reduce:transition-none", focusRing);

const HEADER_CLASS = "box-border flex h-[52px] min-w-0 flex-none items-center gap-2.5 pr-4 pl-[calc(16px+var(--dsh-frame-leading-clearance,0px))]";

function SidebarToggle() {
  const t = useT();
  return (
    <Tooltip label={t("shell.showSidebar")} side="bottom" align="center" delayMs={500}>
      <button
        type="button"
        className={headerButton}
        data-testid={TESTID.headerSidebarToggle}
        aria-label={t("shell.showSidebar")}
        onClick={() => uiState.toggleSidebar()}
      >
        <IconPanelLeftOutlineRegular size={16} />
      </button>
    </Tooltip>
  );
}

/**
 * Window-drag header strip: the breadcrumb (workspace badge, workspace, thread title), the activity chip, the running
 * state, the Open split button and, at the far right, the panel toggles.
 */
export const ConversationHeader = memo(function ConversationHeader({
  active,
  thread,
  running,
  activity,
  panels,
}: {
  active: boolean;
  thread: ThreadSummary | null;
  running: boolean;
  activity?: ReactNode;
  panels?: ReactNode;
}) {
  const t = useT();
  const ui = useUiState();
  const { sidebarVisible } = ui;
  const dockOpen = shownTab(ui) !== null || ui.dockLauncher;
  const toggle = <span className={sidebarVisible ? "hidden in-data-[narrow=true]:inline-flex" : undefined}><SidebarToggle /></span>;
  if (!active) {
    return (
      <header className={HEADER_CLASS} data-blank="" data-testid={TESTID.conversationHeader} data-window-drag>
        {toggle}
      </header>
    );
  }
  const title = threadTitle(thread, t("conversation.header.newSession"));
  const cwd = thread?.cwd ?? "";
  return (
    <header className={HEADER_CLASS} data-testid={TESTID.conversationHeader} data-window-drag>
      {toggle}
      <nav className="flex min-w-0 flex-[0_1_auto] items-center gap-2 text-sm leading-5" aria-label={t("conversation.header.breadcrumb")}>
        {cwd !== "" && (
          <>
            <WorkspaceBadge cwd={cwd} size="sm" />
            <span className="min-w-0 max-w-[220px] flex-[0_1_auto] truncate text-muted-foreground" title={cwd}>
              {workspaceName(cwd)}
            </span>
            <span className="flex-none text-muted-foreground/70" aria-hidden>
              /
            </span>
          </>
        )}
        <h1 className="m-0 min-w-0 flex-[0_1_auto] truncate text-sm font-medium leading-5 text-foreground" title={title}>
          {title}
        </h1>
      </nav>
      <div className="ml-auto flex flex-none items-center gap-2.5">
        {activity}
        {running && (
          <span className="inline-flex flex-none items-center gap-1.5 text-xs leading-[18px] text-muted-foreground" role="status">
            <StateDot state="ongoing" size={12} />
            <TextShimmer active>{t("conversation.header.running")}</TextShimmer>
          </span>
        )}
        {cwd !== "" && <CommitPushButton key={cwd} cwd={cwd} />}
        {cwd !== "" && <OpenButton cwd={cwd} />}
        {panels}
        <Tooltip label={t(dockOpen ? "shell.dock.close" : "shell.dock.open")} side="bottom" align="end" delayMs={500}>
          <button type="button" className={headerButton} data-testid="dock-toggle" aria-pressed={dockOpen}
            aria-label={t(dockOpen ? "shell.dock.close" : "shell.dock.open")} onClick={() => uiState.toggleDock()}>
            <IconPanelLeftOutlineRegular size={16} className={ui.dockSide === "right" ? "-scale-x-100" : undefined} />
          </button>
        </Tooltip>
      </div>
    </header>
  );
});
