// Session tables shared by Settings > Import, the first-run import dialog and the existing-sessions dialog:
// one line per session with title / path / updated / origin columns and checkbox bulk selection.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import clsx from "clsx";
import { TriangleAlert } from "lucide-react";
import type { ImportCandidate } from "../../../shared/ipc";
import { useLocale, useT } from "../../i18n";
import { useActions } from "../app-context";
import { useUiState } from "../ui-state";
import { errorMessage } from "./diagnostics";

/** Checkbox with a neutral accent and an optional mixed state (header "select all"). */
export function Checkbox({ indeterminate = false, className, ...rest }: Omit<ComponentPropsWithoutRef<"input">, "type"> & { indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      {...rest}
      ref={ref}
      type="checkbox"
      className={clsx("m-0 size-4 cursor-pointer accent-foreground disabled:cursor-not-allowed disabled:opacity-50", className)}
    />
  );
}

/** Scroll frame + fixed-layout table; `maxHeight` is a utility such as `max-h-128`. */
export function SessionTable({ maxHeight, columns, head, children, testId }: {
  maxHeight: string;
  /** Width utilities per column after the checkbox column; "" lets a column take the rest. */
  columns: readonly string[];
  head: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className={clsx("min-h-0 w-full overflow-auto rounded-lg border border-solid border-border bg-background", maxHeight)} data-testid={testId}>
      <table className="w-full table-fixed border-collapse text-left text-sm leading-5">
        <colgroup>
          <col className="w-10" />
          {columns.map((width, index) => <col key={index} className={width} />)}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-muted text-xs font-medium text-muted-foreground [&_th]:h-8 [&_th]:px-2 [&_th]:font-medium [&_th]:whitespace-nowrap">
          {head}
        </thead>
        {children}
      </table>
    </div>
  );
}

/** Row classes: one 36px line, hairline divider, hover tint. */
export const rowClass = "h-9 border-0 border-t border-solid border-border hover:bg-accent/50 [&>td]:px-2 [&>td]:align-middle";
/** A single-line, ellipsized cell. */
export const cellClass = "truncate";
/** Path cell: ellipsis on the left so the folder name stays visible. */
export const pathCellClass = "truncate text-muted-foreground [direction:rtl]";

/** Localized date for the Updated column: month, day and time this year, the full date before. */
export function useUpdatedFormat(): (ms: number) => string {
  const locale = useLocale();
  return useMemo(() => {
    const recent = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const older = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
    const year = new Date().getFullYear();
    return (ms: number) => (new Date(ms).getFullYear() === year ? recent : older).format(ms);
  }, [locale]);
}

type Group = "own" | "machine" | "scratch" | "damaged";
const GROUPS: readonly Group[] = ["own", "machine", "scratch", "damaged"];
const GROUP_LABEL = { own: "shell.import.groupOwn", machine: "shell.import.groupMachine", scratch: "shell.import.groupScratch", damaged: "shell.import.groupDamaged" } as const;

function groupOf(candidate: ImportCandidate): Group {
  if (!candidate.importable) return "damaged";
  if (candidate.location !== null) return "scratch";
  return candidate.evidence === "app" || candidate.evidence === "terminal" ? "own" : "machine";
}

/**
 * Import candidates read page by page. The default selection is unchanged: only `recommended` sessions
 * (importable, person-opened, ordinary folder) that are not managed yet start checked.
 */
export function useImportCandidates() {
  const t = useT();
  const actions = useActions();
  const { preferences } = useUiState();
  const managed = useMemo(() => new Set(preferences?.managedThreadIds ?? []), [preferences?.managedThreadIds]);
  const [items, setItems] = useState<ImportCandidate[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [emptyCount, setEmptyCount] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (from: string | null): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const page = await actions.loadImportCandidates(from);
      setItems(current => {
        const known = new Set(current.map(item => item.sessionPath));
        return [...current, ...page.items.filter(item => !known.has(item.sessionPath))];
      });
      setSelected(current => new Set([...current, ...page.items.filter(item => item.recommended && !managed.has(item.id)).map(item => item.sessionPath)]));
      setCursor(page.nextCursor);
      if (from === null) setEmptyCount(page.emptyCount);
    } catch (cause) {
      setError(t("shell.import.failed", { message: errorMessage(cause) }));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(null); }, []);

  const selectable = (item: ImportCandidate): boolean => item.importable && !managed.has(item.id);
  const chosen = items.filter(item => selected.has(item.sessionPath) && selectable(item)).map(item => item.sessionPath);
  const setMany = (paths: readonly string[], on: boolean): void => setSelected(current => {
    const next = new Set(current);
    for (const path of paths) if (on) next.add(path); else next.delete(path);
    return next;
  });
  return { items, managed, selected, chosen, cursor, emptyCount, loading, error, setError, load, setMany, selectable };
}

export type ImportCandidates = ReturnType<typeof useImportCandidates>;

/** The candidate table: grouped tbody sections, header and per-group bulk checkboxes, single-line rows. */
export function ImportTable({ state, busy, maxHeight }: { state: ImportCandidates; busy: boolean; maxHeight: string }) {
  const t = useT();
  const updated = useUpdatedFormat();
  const { items, managed, selected, selectable, setMany } = state;
  const open = items.filter(selectable).map(item => item.sessionPath);
  const checkedCount = open.filter(path => selected.has(path)).length;
  return (
    <SessionTable
      maxHeight={maxHeight}
      columns={["", "w-[28%]", "w-36", "w-28"]}
      head={
        <tr>
          <th scope="col" className="text-center">
            <Checkbox
              aria-label={t("shell.import.selectAll")}
              disabled={busy || open.length === 0}
              checked={open.length > 0 && checkedCount === open.length}
              indeterminate={checkedCount > 0 && checkedCount < open.length}
              onChange={(event) => setMany(open, event.target.checked)}
            />
          </th>
          <th scope="col">{t("shell.import.col.title")}</th>
          <th scope="col">{t("shell.import.col.path")}</th>
          <th scope="col">{t("shell.import.col.updated")}</th>
          <th scope="col">{t("shell.import.col.origin")}</th>
        </tr>
      }
    >
      {GROUPS.map(group => {
        const rows = items.filter(item => groupOf(item) === group);
        if (rows.length === 0) return null;
        const groupOpen = rows.filter(selectable).map(item => item.sessionPath);
        const groupChecked = groupOpen.filter(path => selected.has(path)).length;
        const label = t(GROUP_LABEL[group]);
        return (
          <tbody key={group} data-testid={`session-import-group-${group}`}>
            <tr className="h-8 border-0 border-t border-solid border-border bg-card [&>td]:px-2">
              <td className="text-center">
                {groupOpen.length > 0 && (
                  <Checkbox
                    aria-label={t("shell.import.selectGroup", { group: label })}
                    disabled={busy}
                    checked={groupChecked === groupOpen.length}
                    indeterminate={groupChecked > 0 && groupChecked < groupOpen.length}
                    onChange={(event) => setMany(groupOpen, event.target.checked)}
                  />
                )}
              </td>
              <td colSpan={4} className="text-xs font-semibold text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  {group === "damaged" && <TriangleAlert aria-hidden="true" className="size-3.5 text-warning" />}
                  {label}
                  <span className="font-normal tabular-nums">{rows.length}</span>
                </span>
              </td>
            </tr>
            {rows.map(item => {
              const already = managed.has(item.id);
              const id = `session-import-${item.id}`;
              const title = item.name ?? item.preview?.split("\n")[0] ?? item.id;
              const origin = t(`shell.import.evidence.${item.evidence}`);
              return (
                <tr key={item.sessionPath} className={clsx(rowClass, (already || !item.importable) && "text-muted-foreground")}
                  data-testid="session-import-row" data-session-id={item.id} data-evidence={item.evidence}>
                  <td className="text-center">
                    <Checkbox id={id} disabled={!item.importable || already || busy}
                      checked={already || (item.importable && selected.has(item.sessionPath))}
                      onChange={(event) => setMany([item.sessionPath], event.target.checked)} />
                  </td>
                  <td className={cellClass}>
                    <label htmlFor={id} className="cursor-pointer font-medium" title={`${title}\n${t("shell.import.messages", { count: item.userMessages })}`}>{title}</label>
                  </td>
                  <td className={pathCellClass} title={item.cwd}><bdi dir="ltr">{item.cwd}</bdi></td>
                  <td className="truncate text-xs text-muted-foreground tabular-nums">{updated(item.updatedAtMs)}</td>
                  <td className={clsx(cellClass, "text-xs")} title={already ? `${origin} · ${t("shell.import.managed")}` : origin}>
                    {already ? t("shell.import.managed") : origin}
                  </td>
                </tr>
              );
            })}
          </tbody>
        );
      })}
    </SessionTable>
  );
}
