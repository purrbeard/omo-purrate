import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Input, Modal, observeComposition, ShortcutKeys } from "@deepseek-ai/dsh-client-ui-primitives";
import { useT } from "../../i18n";
import { TESTID } from "../testids";
import { filterPaletteEntries, type PaletteEntry } from "./palette-model";
import css from "./CommandPalette.module.css";

/** Modal owns autofocus, Escape, focus trapping and restoration through useModalLayer. */
export function CommandPalette({ entries, onClose }: { entries: readonly PaletteEntry[]; onClose(): void }) {
  const t = useT();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const composition = useRef<ReturnType<typeof observeComposition> | null>(null);
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
    <Modal open onClose={onClose} title={t("shell.palette.title")} closeLabel={t("common.close")} className={css.dialog}>
      <div className={css.root} data-testid={TESTID.commandPalette} onKeyDown={onKeyDown}>
        <Input
          data-modal-autofocus=""
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
        <div ref={list} id={listId} role="listbox" aria-label={t("shell.palette.title")} className={css.list}>
          {matches.map((entry, entryIndex) => (
            <button
              key={entry.id}
              id={`${listId}-${entryIndex}`}
              type="button"
              role="option"
              aria-selected={entryIndex === index}
              tabIndex={-1}
              className={css.entry}
              data-testid={TESTID.paletteEntry}
              data-entry-id={entry.id}
              data-kind={entry.kind}
              onPointerMove={() => setSelected(entryIndex)}
              onMouseDown={event => event.preventDefault()}
              onClick={() => run(entry)}
            >
              <span className={css.text}><span>{entry.title}</span>{entry.subtitle !== undefined && <span className={css.subtitle}>{entry.subtitle}</span>}</span>
              {entry.shortcut !== undefined && <ShortcutKeys keys={entry.shortcut} className={css.keycaps} />}
            </button>
          ))}
          {matches.length === 0 && <p className={css.empty} data-testid={TESTID.paletteEmpty} role="status">{t("shell.palette.empty")}</p>}
        </div>
        <p className={css.hint}>{t("shell.palette.hint")}</p>
      </div>
    </Modal>
  );
}
