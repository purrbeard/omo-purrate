import { memo, useState } from "react";
import { ChevronDown, FilePen } from "lucide-react";
import clsx from "clsx";
import { useT } from "../../i18n";
import { Button, focusRing } from "../kit";
import { uiState } from "../ui-state";
import type { EditedFile } from "./edited-files";

const COLLAPSED_ROWS = 3;

function Counts({ added, removed, className }: { added: number | null; removed: number | null; className?: string }) {
  if (added === null || removed === null) return null;
  return (
    <span className={clsx("shrink-0 whitespace-nowrap font-mono text-xs leading-5 tabular-nums", className)}>
      <span className="text-success">{`+${added}`}</span> <span className="text-destructive-foreground">{`-${removed}`}</span>
    </span>
  );
}

/** The files one turn changed, with per-file line counts; "View changes" opens the session change history at this turn. */
export const EditedFilesCard = memo(function EditedFilesCard({ files, turnId }: { files: readonly EditedFile[]; turnId: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const counted = files.filter((file) => file.added !== null && file.removed !== null);
  const added = counted.reduce((sum, file) => sum + (file.added ?? 0), 0);
  const removed = counted.reduce((sum, file) => sum + (file.removed ?? 0), 0);
  const shown = expanded ? files : files.slice(0, COLLAPSED_ROWS);
  const hidden = files.length - shown.length;
  const title = t("conversation.files.title", { count: files.length });
  return (
    <section
      className="min-w-0 overflow-hidden rounded-lg border border-solid border-border bg-card text-card-foreground"
      data-testid="edited-files"
      data-flow="files"
      aria-label={title}
    >
      <header className="flex min-w-0 items-center gap-3 px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground" aria-hidden>
          <FilePen className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium leading-5">{title}</span>
          {counted.length > 0 && <Counts added={added} removed={removed} />}
        </div>
        <Button variant="outline" size="sm" data-testid="edited-files-view" onClick={() => uiState.openSessionChanges(turnId)}>
          {t("conversation.files.view")}
        </Button>
      </header>
      <ul className="m-0 list-none border-0 border-t border-solid border-border p-0">
        {shown.map((file) => (
          <li key={file.path} className="flex min-w-0 items-center gap-3 px-3 py-1.5" data-path={file.path}>
            <span className="min-w-0 flex-1 truncate text-xs leading-5 text-foreground" title={file.path}>{file.path}</span>
            <Counts added={file.added} removed={file.removed} />
          </li>
        ))}
      </ul>
      {(hidden > 0 || expanded) && files.length > COLLAPSED_ROWS && (
        <button
          type="button"
          className={clsx(
            "m-0 flex w-full cursor-pointer items-center gap-1.5 border-0 border-t border-solid border-border bg-transparent px-3 py-2",
            "text-left text-xs leading-5 text-muted-foreground [font-family:inherit] hover:bg-accent hover:text-accent-foreground",
            focusRing,
          )}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t("conversation.files.less") : t("conversation.files.more", { count: hidden })}
          <ChevronDown className={clsx("size-3.5 transition-transform motion-reduce:transition-none", expanded && "rotate-180")} aria-hidden />
        </button>
      )}
    </section>
  );
});
