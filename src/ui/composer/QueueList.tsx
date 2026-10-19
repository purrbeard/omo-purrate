import { useState } from "react";
import clsx from "clsx";
import { Pencil, X } from "lucide-react";
import { focusRing } from "../kit";
import { useT } from "../../i18n";
import { TESTID } from "../testids";
import type { QueuedMessage } from "./queue";

const action = clsx(
  "m-0 grid size-6 flex-none cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground",
  "hover:bg-accent hover:text-accent-foreground",
  focusRing,
);
const textButton = clsx(
  "m-0 flex-none cursor-pointer rounded-md border-0 bg-secondary px-2 py-0.5 text-xs leading-[18px] text-secondary-foreground [font-family:inherit] hover:bg-accent",
  focusRing,
);

/**
 * Messages omo holds back for the thread (follow-ups for after the run, steers not yet delivered), each with
 * withdraw and edit. A message omo reported without an id can be read but not changed.
 */
export function QueueList({ items, onWithdraw, onEdit }: {
  items: readonly QueuedMessage[];
  onWithdraw: (item: QueuedMessage) => void;
  onEdit: (item: QueuedMessage, text: string) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState<{ queuedId: string; text: string } | null>(null);
  if (items.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 px-3 pb-0.5" aria-label={t("composer.queue.label")} data-testid={TESTID.composerQueue}>
      {items.map((item, index) => {
        const editable = item.queuedId !== null;
        const isEditing = editable && editing?.queuedId === item.queuedId;
        return (
          <li key={item.queuedId ?? `${index}:${item.text}`} className="flex min-h-7 min-w-0 items-center gap-2 rounded-md bg-muted px-2 text-[13px] leading-5 text-muted-foreground" data-testid={TESTID.queueItem}>
            <span className="flex-none text-[11px] leading-4">{t(item.mode === "followUp" ? "composer.queue.followUp" : "composer.queue.steer")}</span>
            {isEditing ? (
              <>
                <input
                  className="min-w-0 flex-1 rounded-md border border-solid border-border bg-composer px-1.5 py-0.5 text-[13px] text-composer-foreground outline-none [font-family:inherit]"
                  data-testid={TESTID.queueEditInput}
                  aria-label={t("composer.queue.editLabel")}
                  value={editing.text}
                  autoFocus
                  onChange={(event) => setEditing({ queuedId: editing.queuedId, text: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                    if (event.key === "Escape") { event.preventDefault(); setEditing(null); }
                    else if (event.key === "Enter" && editing.text.trim() !== "") { event.preventDefault(); onEdit(item, editing.text.trim()); setEditing(null); }
                  }}
                />
                <button type="button" className={textButton} data-testid={TESTID.queueEditSave} disabled={editing.text.trim() === ""} onClick={() => { onEdit(item, editing.text.trim()); setEditing(null); }}>{t("composer.queue.save")}</button>
                <button type="button" className={textButton} onClick={() => setEditing(null)}>{t("composer.queue.cancel")}</button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-composer-foreground" title={item.text}>{item.text}</span>
                {editable && (
                  <>
                    <button type="button" className={action} data-testid={TESTID.queueEdit} aria-label={t("composer.queue.edit")} title={t("composer.queue.edit")} onClick={() => setEditing({ queuedId: item.queuedId!, text: item.text })}><Pencil className="size-3.5" aria-hidden /></button>
                    <button type="button" className={action} data-testid={TESTID.queueWithdraw} aria-label={t("composer.queue.withdraw")} title={t("composer.queue.withdraw")} onClick={() => onWithdraw(item)}><X className="size-3.5" aria-hidden /></button>
                  </>
                )}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
