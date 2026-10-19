import { useState } from "react";
import type { ReactNode } from "react";
import { Check, ClipboardList, FolderOpen, Paperclip, ScrollText, SquarePen } from "lucide-react";
import type { SkillMetadata } from "../../../shared/protocol";
import { useT } from "../../i18n";
import { skillSummary } from "./skill-draft";
import clsx from "clsx";
import { focusRing, Menu } from "../kit";

export type AddAction = "files" | "folder" | "terminal" | "goal" | "plan" | "sketch";

/** A row label: the action name, then a muted hint that truncates (or wraps below it on narrow windows). */
function Label({ title, hint }: { title: string; hint?: string }) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2 max-[720px]:flex-col max-[720px]:items-start max-[720px]:gap-0">
      <span className="shrink-0 font-medium">{title}</span>
      {hint !== undefined && <small className="min-w-0 truncate text-xs text-muted-foreground max-[720px]:whitespace-normal max-[720px]:leading-[18px]">{hint}</small>}
    </span>
  );
}

const GoalIcon = (): ReactNode => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" /><circle cx="8" cy="8" r="2.5" fill="none" stroke="currentColor" /></svg>
);

export function AddMenu({ disabled, skills, loading, plan, onOpen, onAction, onSkill }: {
  disabled: boolean;
  skills: readonly SkillMetadata[];
  loading: boolean;
  plan: boolean;
  onOpen: () => void;
  onAction: (action: AddAction) => void;
  onSkill: (skill: SkillMetadata) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Menu.Root open={open} onOpenChange={(next) => { if (next) onOpen(); setOpen(next); }}>
      <Menu.Trigger className={clsx("m-0 inline-flex size-7 cursor-pointer items-center justify-center rounded-full border-0 bg-accent p-0 text-muted-foreground transition-colors duration-150 hover:not-disabled:text-foreground disabled:cursor-default disabled:opacity-50 motion-reduce:transition-none", focusRing)} data-testid="composer-add" aria-label={t("composer.add.label")}
        disabled={disabled}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </Menu.Trigger>
      <Menu.Content side="top" className="w-[min(540px,calc(100vw-32px))] rounded-2xl! p-1.5!">
        <Menu.Group>
          <Menu.GroupLabel>{t("composer.add.label")}</Menu.GroupLabel>
          <Menu.Item icon={<Paperclip />} onClick={() => onAction("files")}><Label title={t("composer.add.files")} /></Menu.Item>
          <Menu.Item icon={<FolderOpen />} onClick={() => onAction("folder")}><Label title={t("composer.add.folder")} /></Menu.Item>
          <Menu.Item icon={<span className="inline-flex w-4 shrink-0 justify-center" aria-hidden>›_</span>} onClick={() => onAction("terminal")}>
            <Label title={t("composer.add.terminal")} hint={t("composer.add.terminalHint")} />
          </Menu.Item>
          <Menu.Item icon={<GoalIcon />} onClick={() => onAction("goal")}><Label title={t("composer.add.goal")} hint={t("composer.add.goalHint")} /></Menu.Item>
          <Menu.Item icon={<ClipboardList />} disabled={!skills.some(skill => skill.name === "ulw-plan")} onClick={() => onAction("plan")}>
            <Label title={t("composer.add.plan")} hint={plan ? t("composer.add.planRemove") : t("composer.add.planHint")} />
            {plan && <Check className="ml-auto" aria-hidden />}
          </Menu.Item>
          <Menu.Item icon={<SquarePen />} onClick={() => onAction("sketch")}><Label title={t("composer.add.sketch")} /></Menu.Item>
        </Menu.Group>
        <Menu.Separator />
        <Menu.Group>
          <Menu.GroupLabel>{t("composer.add.skills")}</Menu.GroupLabel>
          {skills.map(skill => (
            <Menu.Item key={skill.name} icon={<ScrollText />} onClick={() => onSkill(skill)}>
              <Label title={skill.interface?.displayName ?? skill.name} hint={skillSummary(skill)} />
            </Menu.Item>
          ))}
          {skills.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">{loading ? t("composer.add.skillsLoading") : t("composer.add.skillsNone")}</div>}
        </Menu.Group>
      </Menu.Content>
    </Menu.Root>
  );
}
