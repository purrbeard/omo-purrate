import { memo, useContext, useState, type ReactElement, type ReactNode } from "react";
import { Download, Ellipsis, PanelLeft } from "lucide-react";
import { useT } from "../../i18n";
import type { ThreadSummary } from "../../state";
import { StoreContext } from "../app-context";
import { WorkspaceBadge } from "../sidebar/WorkspaceBadge";
import { TESTID } from "../testids";
import { shownTab, uiState, useUiState } from "../ui-state";
import { threadTitle, workspaceName } from "./format";
import { OpenButton } from "./OpenButton";
import { CommitPushButton } from "./CommitPushButton";
import clsx from "clsx";
import { Menu, StateDot, TextShimmer, Tooltip, focusRing } from "../kit";

const headerButton = clsx("m-0 -ml-1 inline-flex size-7 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground motion-reduce:transition-none", focusRing);

const HEADER_CLASS = "box-border flex h-[52px] min-w-0 flex-none items-center gap-2.5 pr-4 pl-[calc(16px+var(--dsh-frame-leading-clearance,0px))]";

function HeaderTooltip({ label, align, children }: { label: string; align: "center" | "end"; children: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger delay={500} render={children} />
      <Tooltip.Content side="bottom" align={align}>{label}</Tooltip.Content>
    </Tooltip.Root>
  );
}

/** The header's overflow menu: exporting the active session through omo's own HTML writer. */
function HeaderMenu({ threadId }: { threadId: string }) {
  const t = useT();
  const store = useContext(StoreContext);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const say = (level: "info" | "error", message: string): void => {
    store?.dispatch({ type: "notice/pushed", notice: { id: crypto.randomUUID(), level, message, threadId } });
  };
  const exportSession = (): void => {
    if (busy) return;
    setBusy(true);
    window.omo.exportSession(threadId).then((saved) => {
      if (saved !== null) say("info", t("conversation.export.done", { path: saved.path }));
    }).catch((error: unknown) => {
      say("error", t("conversation.export.failed", { message: error instanceof Error ? error.message : String(error) }));
    }).finally(() => setBusy(false));
  };
  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger className={headerButton} data-testid={TESTID.headerMenu} aria-label={t("conversation.menu.label")}>
        <Ellipsis className="size-4" aria-hidden />
      </Menu.Trigger>
      <Menu.Content align="end" side="bottom">
        <Menu.Item icon={<Download aria-hidden />} disabled={busy} data-testid={TESTID.headerExport} onClick={exportSession}>
          {t("conversation.export.label")}
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

function SidebarToggle() {
  const t = useT();
  return (
    <HeaderTooltip label={t("shell.showSidebar")} align="center">
      <button
        type="button"
        className={headerButton}
        data-testid={TESTID.headerSidebarToggle}
        aria-label={t("shell.showSidebar")}
        onClick={() => uiState.toggleSidebar()}
      >
        <PanelLeft className="size-4" aria-hidden />
      </button>
    </HeaderTooltip>
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
        {thread !== null && <HeaderMenu key={thread.id} threadId={thread.id} />}
        {panels}
        <HeaderTooltip label={t(dockOpen ? "shell.dock.close" : "shell.dock.open")} align="end">
          <button type="button" className={headerButton} data-testid="dock-toggle" aria-pressed={dockOpen}
            aria-label={t(dockOpen ? "shell.dock.close" : "shell.dock.open")} onClick={() => uiState.toggleDock()}>
            <PanelLeft className={clsx("size-4", ui.dockSide === "right" && "-scale-x-100")} aria-hidden />
          </button>
        </HeaderTooltip>
      </div>
    </header>
  );
});
