import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";
import { useLocale, useT } from "../../i18n";
import type { ConversationTurn } from "../../state";
import { useAppSelector } from "../app-context";
import { DiffBlock } from "../content/DiffBlock";
import { editedFileHunks, editedFiles, type EditedFile } from "../conversation/edited-files";
import { useConversationLabels } from "../conversation/labels";
import { formatClockTime } from "../time-format";
import { useUiState } from "../ui-state";

const EMPTY_TURNS: ConversationTurn[] = [];
const MONO = "[font-family:ui-monospace,SFMono-Regular,Consolas,monospace]";
const LINES = clsx("inline-flex flex-none gap-1 text-[10px] leading-4 font-medium text-muted-foreground [&_[data-kind=added]]:text-(--diff-add) [&_[data-kind=removed]]:text-(--diff-remove)", MONO);

export interface SessionChangeGroup {
  turnId: string;
  /** 1-based position of the turn in the session. */
  index: number;
  prompt: string;
  startedAtMs: number | null;
  files: EditedFile[];
}

/** The session's changed files per request, newest first; requests that changed nothing are left out. */
export function sessionChangeGroups(turns: readonly ConversationTurn[], cwd: string | null): SessionChangeGroup[] {
  return turns.flatMap((turn, position) => {
    const files = editedFiles(turn.items, cwd);
    if (files.length === 0) return [];
    const message = turn.items.find((entry) => entry.item.type === "userMessage")?.item;
    const prompt = message?.type === "userMessage"
      ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(" ").replace(/\s+/gu, " ").trim() : "";
    return [{ turnId: turn.id, index: position + 1, prompt, startedAtMs: turn.startedAtMs, files }];
  }).reverse();
}

function Counts({ added, removed }: { added: number | null; removed: number | null }) {
  if (added === null || removed === null) return null;
  return <span className={LINES}><span data-kind="added">+{added}</span><span data-kind="removed">−{removed}</span></span>;
}

/** One changed file; its diff renders only while open so a long session stays cheap to list. */
function ChangedFile({ file }: { file: EditedFile }) {
  const t = useT();
  const labels = useConversationLabels();
  const [open, setOpen] = useState(false);
  const hunks = useMemo(() => (open ? editedFileHunks(file) : []), [open, file]);
  return (
    <details className="group/file min-w-0" data-testid="workspace-session-file" data-path={file.path}
      onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className={clsx(
        "flex min-w-0 cursor-pointer list-none items-center gap-1.5 rounded-[5px] px-2 py-1 text-[11px] text-muted-foreground hover:bg-sidebar-accent",
        "[&::-webkit-details-marker]:hidden group-open/file:text-foreground",
      )} title={file.path}>
        <ChevronRight className="size-3 flex-none transition-transform group-open/file:rotate-90 motion-reduce:transition-none" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{file.path}</span>
        <Counts added={file.added} removed={file.removed} />
      </summary>
      {open && <div className="px-1 pt-1 pb-2">
        {hunks.length === 0
          ? <p className="m-0 px-2 py-1 text-[11px] text-muted-foreground">{t("workspace.panel.noRecordedDiff")}</p>
          : <DiffBlock diffs={hunks} labels={labels.diff} className="m-0! rounded-md! border! border-solid! border-border!" />}
      </div>}
    </details>
  );
}

/**
 * The changes the session file itself records (file tool results and native file changes), grouped by request,
 * newest first. Independent of git and of the session cwd, so terminal-run and app-run sessions read the same.
 */
export function SessionChanges({ threadId, cwd, filter, focusTurnId, onFocused }: {
  threadId: string; cwd: string | null; filter: string; focusTurnId: string | null; onFocused: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const timeFormat = useUiState().preferences?.timeFormat ?? "system";
  const turns = useAppSelector((state) => state.conversations[threadId]?.turns ?? EMPTY_TURNS);
  const groups = useMemo(() => sessionChangeGroups(turns, cwd), [turns, cwd]);
  const needle = filter.toLowerCase();
  const shown = groups.flatMap((group) => {
    const files = group.files.filter((file) => file.path.toLowerCase().includes(needle));
    return files.length === 0 ? [] : [{ ...group, files }];
  });
  const listRef = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  useEffect(() => {
    if (focusTurnId === null) return;
    const target = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-turn-id]") ?? [])].find((element) => element.dataset["turnId"] === focusTurnId);
    if (target === undefined) return;
    target.scrollIntoView({ block: "start" });
    target.focus({ preventScroll: true });
    setHighlight(focusTurnId);
    onFocused();
  }, [focusTurnId, shown.length, onFocused]);
  return (
    <div ref={listRef} className="flex min-w-0 flex-col gap-1 px-1 pb-2" data-testid="workspace-session-changes">
      <p className="mx-2 my-1.5 text-[11px] text-muted-foreground">{t("workspace.panel.sessionChangesNote")}</p>
      {shown.length === 0 && <p className="m-0 px-2 py-3 text-muted-foreground">{t("workspace.panel.noSessionChanges")}</p>}
      {shown.map((group) => {
        const counted = group.files.filter((file) => file.added !== null && file.removed !== null);
        return (
          <section key={group.turnId} tabIndex={-1} data-testid="workspace-session-turn" data-turn-id={group.turnId}
            data-focused={group.turnId === highlight || undefined}
            className="min-w-0 scroll-mt-1 rounded-md border border-solid border-transparent py-1 outline-none focus-visible:border-ring data-focused:border-ring">
            <h3 className="mx-2 my-0.5 flex min-w-0 items-baseline gap-2 text-xs leading-[1.5] font-semibold [font-family:inherit]" title={group.prompt}>
              <span className="flex-none">{t("workspace.panel.request", { index: group.index })}</span>
              <span className="min-w-0 flex-1 truncate font-normal text-muted-foreground">{group.prompt}</span>
              {counted.length > 0 && <Counts added={counted.reduce((sum, file) => sum + (file.added ?? 0), 0)} removed={counted.reduce((sum, file) => sum + (file.removed ?? 0), 0)} />}
              {group.startedAtMs !== null && <time className="flex-none text-[10px] font-normal text-muted-foreground tabular-nums" dateTime={new Date(group.startedAtMs).toISOString()}>
                {formatClockTime(group.startedAtMs, timeFormat, locale)}
              </time>}
            </h3>
            {group.files.map((file) => <ChangedFile key={file.path} file={file} />)}
          </section>
        );
      })}
    </div>
  );
}
