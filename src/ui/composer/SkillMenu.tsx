import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import clsx from "clsx";
import { useAnchoredMaxHeight } from "../lib/anchored";
import type { SkillErrorInfo, SkillScope } from "../../../shared/protocol";
import { useT } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { TESTID } from "../testids";
import type { MenuOption } from "./commands";
import { MAX_SKILLS_PER_MESSAGE, skillSummary } from "./skill-draft";
import { CircleAlert } from "lucide-react";
import { focusRing, MenuSurface } from "../kit";
import { userErrorText } from "../conversation/user-error";

const STATUS = "box-border flex min-h-[34px] flex-none items-center gap-2 px-2 py-1.5 text-xs leading-[18px] text-muted-foreground";
const STATUS_TEXT = "min-w-0 flex-1 [overflow-wrap:anywhere]";
const ITEM = "m-0 box-border flex min-h-10 w-full flex-none cursor-pointer flex-col items-stretch gap-0.5 rounded-lg border-0 px-2.5 py-2 text-left text-[13px] leading-5 text-popover-foreground [font-family:inherit]";
const DESC = "line-clamp-2 text-xs leading-[18px] [overflow-wrap:anywhere] text-muted-foreground";
const TAG = "flex-none text-[11px] leading-4 text-muted-foreground";

const MAX_HEIGHT = 400;
const TOP_MARGIN = 84;

const SCOPE_KEY: Record<SkillScope, MessageKey> = {
  user: "composer.skills.scope.user",
  repo: "composer.skills.scope.repo",
  system: "composer.skills.scope.system",
  admin: "composer.skills.scope.admin",
};

export type SkillMenuStatus =
  | { kind: "startSession" }
  | { kind: "resumeSession" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export interface SkillMenuProps {
  listboxId: string;
  optionId: (index: number) => string;
  status: SkillMenuStatus;
  /** Skill and command rows in display order; `activeIndex`, `onPick` and `onHover` index into it. */
  options: readonly MenuOption[];
  /** Per-file diagnostics of a ready catalog; shown as one warning row beside the skills. */
  diagnostics: readonly SkillErrorInfo[];
  catalogEmpty: boolean;
  activeIndex: number;
  limitReached: boolean;
  onPick: (index: number) => void;
  onHover: (index: number) => void;
  onRetry: () => void;
  onDismiss: () => void;
}

const keepFocus = (event: MouseEvent): void => {
  event.preventDefault();
};

/**
 * The "/" skill menu, anchored above the composer card (adapted from DSH MenuView). Focus stays
 * in the textarea: rows pick on mousedown and the highlight is exposed through the textarea's
 * aria-activedescendant. A pointer down outside the element marked `data-composer-card` dismisses.
 */
export function SkillMenu({
  listboxId,
  optionId,
  status,
  options,
  diagnostics,
  catalogEmpty,
  activeIndex,
  limitReached,
  onPick,
  onHover,
  onRetry,
  onDismiss,
}: SkillMenuProps) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);
  const maxHeight = useAnchoredMaxHeight(menuRef, MAX_HEIGHT, `${status.kind}:${options.length}:${String(limitReached)}`, TOP_MARGIN);

  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, optionId]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (menuRef.current?.contains(event.target) === true) return;
      if (menuRef.current?.closest("[data-composer-card]")?.contains(event.target) === true) return;
      onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onDismiss]);

  const hint =
    status.kind === "startSession"
      ? t("composer.skills.startSession")
      : status.kind === "resumeSession"
        ? t("composer.skills.resumeSession")
        : null;

  return (
    <MenuSurface ref={menuRef} className="absolute! right-0 bottom-[calc(100%+4px)] left-0 z-[100] flex max-h-[400px] flex-col overflow-hidden rounded-2xl! p-1.5" style={{ maxHeight }} data-testid={TESTID.skillMenu}>
      {limitReached && (
        <div className={clsx(STATUS, "font-medium text-foreground")} role="alert" data-testid={TESTID.skillLimit}>
          {t("composer.skills.limit", { max: MAX_SKILLS_PER_MESSAGE })}
        </div>
      )}
      {hint !== null && (
        <div className={STATUS} role="status">
          <span className={STATUS_TEXT}>{hint}</span>
        </div>
      )}
      {status.kind === "error" && (
        <div className={clsx("box-border flex min-h-[34px] flex-none items-center gap-2 px-2 py-1.5 text-xs leading-[18px]", "text-destructive-foreground")} role="alert">
          <CircleAlert className="size-3.5 flex-none" aria-hidden />
          <span className={STATUS_TEXT}>{t("composer.skills.error", { message: userErrorText(status.message, t("conversation.error.requestFailed")).text })}</span>
          <button type="button" className={clsx("m-0 flex-none cursor-pointer rounded-md border-0 bg-secondary px-2 py-0.5 text-xs leading-[18px] text-secondary-foreground [font-family:inherit] hover:bg-accent", focusRing)} onMouseDown={keepFocus} onClick={onRetry}>
            {t("composer.skills.retry")}
          </button>
        </div>
      )}
      {status.kind === "ready" && diagnostics.length > 0 && (
        <div
          className={STATUS}
          role="status"
          data-testid={TESTID.skillMenuWarning}
          title={diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n")}
        >
          <span className={STATUS_TEXT}>{t("composer.skills.diagnostics", { count: diagnostics.length })}</span>
        </div>
      )}
      {status.kind === "loading" && options.length === 0 && (
        <div className={STATUS} role="status" aria-label={t("composer.skills.loading")}>
          <span className="h-[18px] animate-pulse rounded-xs bg-muted motion-reduce:animate-none" style={{ width: "40%" }} />
        </div>
      )}
      {status.kind === "ready" && options.length === 0 && (
        <div className={STATUS} role="status" data-testid={TESTID.skillMenuEmpty}>
          <span className={STATUS_TEXT}>{t(catalogEmpty ? "composer.skills.empty" : "composer.skills.noMatch")}</span>
        </div>
      )}
      <div id={listboxId} className="scrollable flex min-h-0 flex-col overflow-y-auto" role="listbox" aria-label={t("composer.skills.label")}>
        {options.map((option, index) => {
          const active = index === activeIndex;
          if (option.kind === "command") {
            const { command } = option;
            return (
              <button
                key={`command:${command.name}`}
                id={optionId(index)}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={active}
                className={clsx(ITEM, active ? "bg-accent" : "bg-transparent")}
                data-testid={TESTID.commandOption}
                data-command={command.name}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onPick(index);
                }}
                onMouseMove={active ? undefined : () => onHover(index)}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 flex-[0_1_auto] truncate">{`/${command.name}`}</span>
                  <span className={TAG}>{t(`composer.commands.${command.source ?? "builtin"}`)}</span>
                  {command.aliases.map((alias) => (
                    <span key={alias} className={TAG}>
                      {t("btw.command.alias", { alias })}
                    </span>
                  ))}
                </span>
                <span className={DESC}>{command.nativeDescription ?? t(command.description)}</span>
              </button>
            );
          }
          const { skill } = option;
          const summary = skillSummary(skill);
          return (
            <button
              key={skill.path}
              id={optionId(index)}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={active}
              className={clsx(ITEM, active ? "bg-accent" : "bg-transparent")}
              data-testid={TESTID.skillOption}
              data-skill-name={skill.name}
              title={skill.path}
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(index);
              }}
              onMouseMove={active ? undefined : () => onHover(index)}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 flex-[0_1_auto] truncate">{skill.name}</span>
                <span className={TAG}>{t("composer.commands.skill")}</span>
                <span className={TAG}>{t(SCOPE_KEY[skill.scope])}</span>
                {!skill.enabled && (
                  <span className="flex-none rounded-xs bg-muted px-[5px] text-[11px] leading-4 text-muted-foreground" title={t("composer.skills.userOnlyHint")}>
                    {t("composer.skills.userOnly")}
                  </span>
                )}
              </span>
              {summary !== "" && <span className={DESC}>{summary}</span>}
            </button>
          );
        })}
      </div>
    </MenuSurface>
  );
}
