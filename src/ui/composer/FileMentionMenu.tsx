import { useEffect, useRef } from "react";
import clsx from "clsx";
import { useT } from "../../i18n";
import type { WorkspaceFileMatch } from "../../../shared/workspace";
import { MenuSurface } from "../kit";
import { useAnchoredMaxHeight } from "../lib/anchored";
import { TESTID } from "../testids";

const STATUS = "box-border flex min-h-[34px] flex-none items-center px-2 py-1.5 text-xs leading-[18px] text-muted-foreground";
const ITEM = "m-0 box-border flex min-h-9 w-full flex-none cursor-pointer flex-col items-stretch gap-0 rounded-lg border-0 px-2.5 py-1.5 text-left text-[13px] leading-5 text-popover-foreground [font-family:inherit]";

function split(path: string): { name: string; folder: string } {
  const cut = path.lastIndexOf("/");
  return { name: path.slice(cut + 1), folder: cut < 0 ? "" : path.slice(0, cut) };
}

/** The "@" file menu: anchored like the "/" menu, focus stays in the textarea, rows pick on mousedown. */
export function FileMentionMenu({ listboxId, optionId, files, loading, activeIndex, onPick, onHover, onDismiss }: {
  listboxId: string;
  optionId: (index: number) => string;
  files: readonly WorkspaceFileMatch[];
  loading: boolean;
  activeIndex: number;
  onPick: (index: number) => void;
  onHover: (index: number) => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);
  const maxHeight = useAnchoredMaxHeight(menuRef, 320, `${String(loading)}:${files.length}`, 84);

  useEffect(() => {
    if (activeIndex >= 0) document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, optionId]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (menuRef.current?.closest("[data-composer-card]")?.contains(event.target) === true) return;
      onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onDismiss]);

  return (
    <MenuSurface ref={menuRef} className="absolute! right-0 bottom-[calc(100%+4px)] left-0 z-[100] flex max-h-[320px] flex-col overflow-hidden rounded-2xl! p-1.5" style={{ maxHeight }} data-testid={TESTID.mentionMenu}>
      {files.length === 0 && (
        <div className={STATUS} role="status" data-testid={TESTID.mentionEmpty}>{t(loading ? "composer.mention.loading" : "composer.mention.empty")}</div>
      )}
      <div id={listboxId} className="scrollable flex min-h-0 flex-col overflow-y-auto" role="listbox" aria-label={t("composer.mention.label")}>
        {files.map((file, index) => {
          const { name, folder } = split(file.path);
          return (
            <button
              key={file.path}
              id={optionId(index)}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={index === activeIndex}
              className={clsx(ITEM, index === activeIndex ? "bg-accent" : "bg-transparent")}
              data-testid={TESTID.mentionOption}
              data-path={file.path}
              title={file.path}
              onMouseDown={(event) => { event.preventDefault(); onPick(index); }}
              onMouseMove={index === activeIndex ? undefined : () => onHover(index)}
            >
              <span className="min-w-0 truncate">{name}</span>
              {folder !== "" && <span className="min-w-0 truncate text-xs leading-[18px] text-muted-foreground">{folder}</span>}
            </button>
          );
        })}
      </div>
    </MenuSurface>
  );
}
