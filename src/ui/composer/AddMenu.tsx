import { useState } from "react";
import { IconPaperclipOutlineRegular, IconFolderOpenOutlineRegular, IconPlanOutlineRegular, IconSkillOutlineRegular, IconEditOutlineRegular, Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import type { MenuEntry } from "@deepseek-ai/dsh-client-ui-primitives";
import type { SkillMetadata } from "../../../shared/protocol";
import { useT } from "../../i18n";
import { skillSummary } from "./skill-draft";
import css from "./AddMenu.module.css";

export type AddAction = "files" | "folder" | "terminal" | "goal" | "plan" | "sketch";

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
  const entries: MenuEntry[] = [
    { type: "label", id: "add-label", text: t("composer.add.label") },
    { id: "files", label: t("composer.add.files"), icon: <IconPaperclipOutlineRegular size={16} /> },
    { id: "folder", label: t("composer.add.folder"), icon: <IconFolderOpenOutlineRegular size={16} /> },
    { id: "terminal", label: <><span>{t("composer.add.terminal")}</span><small>{t("composer.add.terminalHint")}</small></>, icon: <span aria-hidden>›_</span> },
    { id: "goal", label: <><span>{t("composer.add.goal")}</span><small>{t("composer.add.goalHint")}</small></>, icon: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" /><circle cx="8" cy="8" r="2.5" fill="none" stroke="currentColor" /></svg> },
    { id: "plan", disabled: !skills.some(skill => skill.name === "ulw-plan"), label: <><span>{t("composer.add.plan")}</span><small>{plan ? t("composer.add.planRemove") : t("composer.add.planHint")}</small></>, icon: <IconPlanOutlineRegular size={16} /> },
    { id: "sketch", label: t("composer.add.sketch"), icon: <IconEditOutlineRegular size={16} /> },
    { type: "separator", id: "skills-separator" },
    { type: "label", id: "skills-label", text: t("composer.add.skills") },
    ...skills.map(skill => ({ id: `skill:${skill.name}`, label: <><span>{skill.interface?.displayName ?? skill.name}</span><small>{skillSummary(skill)}</small></>, icon: <IconSkillOutlineRegular size={16} /> })),
  ];
  if (skills.length === 0) entries.push({ type: "label", id: "skills-status", text: loading ? t("composer.add.skillsLoading") : t("composer.add.skillsNone") });
  return <Menu open={open} side="top" portal autoFocus listClassName={css.menu} items={entries}
    selectedId={plan ? "plan" : undefined} onClose={() => setOpen(false)}
    onSelect={id => {
      setOpen(false);
      const skill = skills.find(skill => id === `skill:${skill.name}`);
      if (skill !== undefined) { onSkill(skill); return; }
      switch (id) {
        case "files": case "folder": case "terminal": case "goal": case "plan": case "sketch": onAction(id); break;
      }
    }}
    anchor={<button type="button" className={css.trigger} data-testid="composer-add" aria-label={t("composer.add.label")}
      aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => { if (!open) onOpen(); setOpen(!open); }}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
    </button>} />;
}
