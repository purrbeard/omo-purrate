import clsx from "clsx";
import { ChevronDown, FolderGit2, FolderOpen } from "lucide-react";
import { useT } from "../../i18n";
import { selectActiveCwd } from "../../state";
import { useAppSelector } from "../app-context";
import { focusRing } from "../kit";
import { TESTID } from "../testids";
import { useGitInfo } from "../git/use-git-info";
import { middleTruncate } from "../git/middle-truncate";
import { BranchGlyph } from "../glyphs";
import { uiState, useUiState } from "../ui-state";

const BRANCH_MAX_LENGTH = 28;

function basename(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? path;
}

/**
 * Thin bar attached under the composer card: the workspace folder button (opens the in-app files
 * panel) on the left, and the current branch with upstream ahead/behind counts
 * on the right. Both hide for non-git folders; counts hide for branches without an upstream.
 */
export function CheckoutBar() {
  const t = useT();
  const cwd = useAppSelector(selectActiveCwd);
  const info = useGitInfo(cwd);
  const { workspacePanelOpen } = useUiState();
  if (cwd === null) return null;
  return (
    <div
      className="box-border flex h-7 w-full max-w-3xl select-none items-center justify-between gap-3 px-2.5 text-xs leading-5 text-muted-foreground"
      data-testid={TESTID.checkoutBar}
      data-git={info !== null ? "" : undefined}
      data-ahead={info?.ahead ?? undefined}
      data-behind={info?.behind ?? undefined}
    >
      <div className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        className={clsx(
          "m-0 inline-flex h-6 min-w-0 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 text-xs leading-5 text-muted-foreground [font-family:inherit]",
          "transition-colors duration-150 hover:bg-accent hover:text-accent-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground motion-reduce:transition-none",
          focusRing,
        )}
        data-testid={TESTID.checkoutFolder}
        aria-label={t("composer.checkout.open", { path: cwd })}
        title={cwd}
        aria-pressed={workspacePanelOpen}
        onClick={() => uiState.setWorkspacePanelOpen(!workspacePanelOpen)}
      >
        <FolderOpen className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{basename(cwd)}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
      </button>
      {info?.worktree === true && (
        <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-sm bg-muted px-1.5 text-xs leading-4 text-muted-foreground" data-testid="checkout-worktree" title={info.root}>
          <FolderGit2 className="size-3" aria-hidden />
          {t("composer.checkout.worktree")}
        </span>
      )}
      </div>
      {info !== null && (
        <span
          className="inline-flex h-6 max-w-[60%] flex-none items-center gap-1.5 px-1.5 text-xs leading-5 text-muted-foreground"
          data-testid={TESTID.checkoutBranch}
          data-branch={info.branch}
          title={t("composer.checkout.branch", { branch: info.branch })}
        >
          {info.ahead !== null && info.behind !== null && (
            <span className="inline-flex flex-none items-center gap-1 tabular-nums" data-testid={TESTID.checkoutCounts} aria-label={t("composer.checkout.counts", { ahead: info.ahead, behind: info.behind })}>
              <span aria-hidden>↑{info.ahead}</span>
              <span aria-hidden>↓{info.behind}</span>
            </span>
          )}
          <BranchGlyph size={13} className="shrink-0" />
          <span className="min-w-0 truncate">{middleTruncate(info.branch, BRANCH_MAX_LENGTH)}</span>
        </span>
      )}
    </div>
  );
}
