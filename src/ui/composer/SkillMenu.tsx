import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import clsx from "clsx";
import { MenuSurface, useAnchoredMaxHeight } from "@deepseek-ai/dsh-client-ui-primitives";
import type { SkillErrorInfo, SkillScope } from "../../../shared/protocol";
import { useT } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { TESTID } from "../testids";
import type { MenuOption } from "./commands";
import { MAX_SKILLS_PER_MESSAGE, skillSummary } from "./skill-draft";
import css from "./SkillMenu.module.css";

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
    <MenuSurface ref={menuRef} className={css.menu} style={{ maxHeight }} data-testid={TESTID.skillMenu}>
      {limitReached && (
        <div className={clsx(css.status, css.notice)} role="alert" data-testid={TESTID.skillLimit}>
          {t("composer.skills.limit", { max: MAX_SKILLS_PER_MESSAGE })}
        </div>
      )}
      {hint !== null && (
        <div className={css.status} role="status">
          <span className={css.statusText}>{hint}</span>
        </div>
      )}
      {status.kind === "error" && (
        <div className={clsx(css.status, css.error)} role="alert">
          <span className={css.statusText}>{t("composer.skills.error", { message: status.message })}</span>
          <button type="button" className={css.retry} onMouseDown={keepFocus} onClick={onRetry}>
            {t("composer.skills.retry")}
          </button>
        </div>
      )}
      {status.kind === "ready" && diagnostics.length > 0 && (
        <div
          className={css.status}
          role="status"
          data-testid={TESTID.skillMenuWarning}
          title={diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n")}
        >
          <span className={css.statusText}>{t("composer.skills.diagnostics", { count: diagnostics.length })}</span>
        </div>
      )}
      {status.kind === "loading" && options.length === 0 && (
        <div className={css.status} role="status" aria-label={t("composer.skills.loading")}>
          <span className={css.skeletonBar} style={{ width: "40%" }} />
        </div>
      )}
      {status.kind === "ready" && options.length === 0 && (
        <div className={css.status} role="status" data-testid={TESTID.skillMenuEmpty}>
          <span className={css.statusText}>{t(catalogEmpty ? "composer.skills.empty" : "composer.skills.noMatch")}</span>
        </div>
      )}
      <div id={listboxId} className={clsx(css.viewport, "scrollable")} role="listbox" aria-label={t("composer.skills.label")}>
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
                className={clsx(css.item, active && css.active)}
                data-testid={TESTID.commandOption}
                data-command={command.name}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onPick(index);
                }}
                onMouseMove={active ? undefined : () => onHover(index)}
              >
                <span className={css.head}>
                  <span className={css.name}>{`/${command.name}`}</span>
                  <span className={css.scope}>{t("btw.command.kind")}</span>
                  {command.aliases.map((alias) => (
                    <span key={alias} className={css.scope}>
                      {t("btw.command.alias", { alias })}
                    </span>
                  ))}
                </span>
                <span className={css.description}>{t(command.description)}</span>
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
              className={clsx(css.item, active && css.active)}
              data-testid={TESTID.skillOption}
              data-skill-name={skill.name}
              title={skill.path}
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(index);
              }}
              onMouseMove={active ? undefined : () => onHover(index)}
            >
              <span className={css.head}>
                <span className={css.name}>{skill.name}</span>
                <span className={css.scope}>{t(SCOPE_KEY[skill.scope])}</span>
                {!skill.enabled && (
                  <span className={css.badge} title={t("composer.skills.userOnlyHint")}>
                    {t("composer.skills.userOnly")}
                  </span>
                )}
              </span>
              {summary !== "" && <span className={css.description}>{summary}</span>}
            </button>
          );
        })}
      </div>
    </MenuSurface>
  );
}
