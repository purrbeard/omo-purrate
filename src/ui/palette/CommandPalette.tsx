import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import clsx from "clsx";
import { Search } from "lucide-react";
import { ShortcutKeys } from "@deepseek-ai/dsh-client-ui-primitives";
import { observeComposition } from "../lib/keyboard-composition";
import { useT } from "../../i18n";
import { Dialog } from "../kit";
import { TESTID } from "../testids";
import { filterPaletteEntries, type PaletteEntry } from "./palette-model";

/** The kit Dialog owns Escape, focus trapping and restoration; the search input takes initial focus. */
export function CommandPalette({ entries, onClose }: { entries: readonly PaletteEntry[]; onClose(): void }) {
  const t = useT();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const composition = useRef<ReturnType<typeof observeComposition> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => filterPaletteEntries(entries, query), [entries, query]);
  const index = Math.min(selected, Math.max(0, matches.length - 1));

  useEffect(() => {
    const observer = observeComposition(document);
    composition.current = observer;
    return () => { observer.dispose(); composition.current = null; };
  }, []);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [index, matches]);

  const run = (entry: PaletteEntry): void => {
    onClose();
    entry.run();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (composition.current?.guards(event.nativeEvent) || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (matches.length > 0) setSelected((index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const entry = matches[index];
      if (entry !== undefined && !event.repeat) run(entry);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content initialFocus={input}>
        <Dialog.Title className="sr-only">{t("shell.palette.title")}</Dialog.Title>
        <div className="flex min-w-0 flex-col gap-3" data-testid={TESTID.commandPalette} onKeyDown={onKeyDown}>
          <div className="flex h-10 items-center gap-2 rounded-md border border-solid border-input bg-background px-3 text-muted-foreground focus-within:border-ring">
            <Search aria-hidden className="size-4 shrink-0" />
            <input
              ref={input}
              className="m-0 h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-foreground outline-none [font-family:inherit] placeholder:text-muted-foreground"
              data-testid={TESTID.paletteInput}
              role="combobox"
              aria-label={t("shell.palette.placeholder")}
              aria-controls={listId}
              aria-expanded="true"
              aria-autocomplete="list"
              aria-activedescendant={matches[index] === undefined ? undefined : `${listId}-${index}`}
              placeholder={t("shell.palette.placeholder")}
              value={query}
              spellCheck={false}
              onChange={event => { setQuery(event.target.value); setSelected(0); }}
            />
          </div>
          <div ref={list} id={listId} role="listbox" aria-label={t("shell.palette.title")} className="-mx-2 max-h-[min(360px,45vh)] overflow-y-auto">
            {matches.map((entry, entryIndex) => (
              <button
                key={entry.id}
                id={`${listId}-${entryIndex}`}
                type="button"
                role="option"
                aria-selected={entryIndex === index}
                tabIndex={-1}
                className={clsx(
                  "m-0 box-border flex w-full cursor-pointer items-center justify-between gap-4 rounded-md border-0 bg-transparent px-3 py-2.5 text-left text-sm text-popover-foreground [font-family:inherit]",
                  "aria-selected:bg-accent aria-selected:text-accent-foreground max-[480px]:gap-2 max-[480px]:px-1.5",
                )}
                data-testid={TESTID.paletteEntry}
                data-entry-id={entry.id}
                data-kind={entry.kind}
                onPointerMove={() => setSelected(entryIndex)}
                onMouseDown={event => event.preventDefault()}
                onClick={() => run(entry)}
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate">{entry.title}</span>
                  {entry.subtitle !== undefined && <span className="truncate text-xs text-muted-foreground">{entry.subtitle}</span>}
                </span>
                {entry.shortcut !== undefined && <ShortcutKeys keys={entry.shortcut} className="shrink-0" />}
              </button>
            ))}
            {matches.length === 0 && <p className="m-0 px-3 py-2 text-xs text-muted-foreground" data-testid={TESTID.paletteEmpty} role="status">{t("shell.palette.empty")}</p>}
          </div>
          <p className="m-0 text-xs leading-normal text-muted-foreground">{t("shell.palette.hint")}</p>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
