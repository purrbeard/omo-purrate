import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import { useT } from "../../i18n";
import { selectDagRuns, selectTasks, selectThreadLiveState } from "../../state";
import { useAppSelector } from "../app-context";
import { workSummary } from "../conversation/activity-model";
import { uiState } from "../ui-state";
import css from "./BackgroundWorkStrip.module.css";

/** Child work remains visible after the main turn settles, until the live work itself settles. */
export function BackgroundWorkStrip({ threadId }: { threadId: string }) {
  const t = useT();
  const runs = useAppSelector((state) => selectDagRuns(state, threadId));
  const tasks = useAppSelector((state) => selectTasks(state, threadId));
  const live = useAppSelector((state) => selectThreadLiveState(state, threadId)?.freshness === "live");
  const { running } = workSummary(runs, tasks, live);
  if (running === 0) return null;
  return (
    <button type="button" className={css.strip} data-testid="background-work-strip" data-running={running}
      onClick={() => uiState.setWorkflowPanelOpen(true)}>
      <StateDot state="ongoing" size={10} />
      <span className={css.count}>{t("composer.background.running", { count: running })}</span>
      <span className={css.open}>{t("composer.background.open")}</span>
    </button>
  );
}
