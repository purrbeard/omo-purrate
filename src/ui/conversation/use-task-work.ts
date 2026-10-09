import { useEffect, useState } from "react";
import { useAppSelector, useAppStore } from "../../state";

/** Disk-only child todos and nested records refresh while inspected; never resumes a child or starts a turn. */
export function useTaskWork(threadId: string): string | null {
  const store = useAppStore();
  const cwd = useAppSelector((state) => state.threads[threadId]?.cwd);
  const live = useAppSelector((state) => state.conversations[threadId]?.live);
  const [error, setError] = useState<string | null>(null);
  const ticking = live?.freshness === "live" && (
    Object.values(live.tasks).some((task) => task.status === "running" || task.status === "pending") ||
    live.taskWork.some((work) => work.task.status === "running") ||
    Object.values(live.runs).some((run) => run.status === "running")
  );
  useEffect(() => {
    if (cwd === undefined || live === undefined) return;
    let disposed = false;
    let reading = false;
    const generation = live.generation;
    const refresh = async (): Promise<void> => {
      if (reading) return;
      reading = true;
      try {
        const work = await window.omo.loadTaskWork(cwd, threadId);
        if (!disposed) {
          store.dispatch({ type: "taskWork/loaded", threadId, work, generation });
          setError(null);
        }
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        reading = false;
      }
    };
    void refresh();
    const delivered = (event: Event): void => { if (event instanceof CustomEvent && event.detail === threadId) void refresh(); };
    window.addEventListener("omo-ui:task-message", delivered);
    const timer = ticking ? setInterval(() => void refresh(), 2000) : null;
    const unsubscribe = window.omo.onNotification((notification) => {
      if (notification.method !== "extension_event") return;
      const params = notification.params;
      if (typeof params === "object" && params !== null && "threadId" in params && params.threadId === threadId) void refresh();
    });
    return () => {
      disposed = true;
      window.removeEventListener("omo-ui:task-message", delivered);
      if (timer !== null) clearInterval(timer);
      unsubscribe();
    };
  }, [cwd, threadId, live?.generation, ticking, store]);
  return error;
}
