import { StateDot } from "../kit";
import { useT } from "../../i18n";
import { selectDagRuns, selectTasks, selectThreadLiveState } from "../../state";
import { useAppSelector } from "../app-context";
import { workSummary } from "../conversation/activity-model";
import { uiState } from "../ui-state";
import clsx from "clsx";

/** Child work remains visible after the main turn settles, until the live work itself settles. */
export function BackgroundWorkStrip({ threadId }: { threadId: string }) {
  const t = useT();
  const runs = useAppSelector((state) => selectDagRuns(state, threadId));
  const tasks = useAppSelector((state) => selectTasks(state, threadId));
  const live = useAppSelector((state) => selectThreadLiveState(state, threadId)?.freshness === "live");
  const { running } = workSummary(runs, tasks, live);
  if (running === 0) return null;
  return (
    <button type="button" className={clsx("m-0 box-border flex min-h-9 cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1 text-left text-[13px] leading-5 text-muted-foreground [font-family:inherit]", "transition-colors duration-150 hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid motion-reduce:transition-none")} data-testid="background-work-strip" data-running={running}
      onClick={() => uiState.setWorkflowPanelOpen(true)}>
      <StateDot state="ongoing" size={10} />
      <span className="min-w-0 truncate">{t("composer.background.running", { count: running })}</span>
      <span className="ml-auto flex-none text-foreground">{t("composer.background.open")}</span>
    </button>
  );
}
