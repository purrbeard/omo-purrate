import { useState } from "react";
import { IconPaperclipOutlineRegular, IconFolderOpenOutlineRegular, IconPlanOutlineRegular, IconSkillOutlineRegular, IconEditOutlineRegular, Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import type { MenuEntry } from "@deepseek-ai/dsh-client-ui-primitives";
import type { SkillMetadata } from "../../../shared/protocol";
import { useLocale } from "../../i18n";
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
  const ko = useLocale() === "ko";
  const [open, setOpen] = useState(false);
  const entries: MenuEntry[] = [
    { type: "label", id: "add-label", text: ko ? "추가" : "Add" },
    { id: "files", label: ko ? "파일 첨부" : "Attach files", icon: <IconPaperclipOutlineRegular size={16} /> },
    { id: "folder", label: ko ? "폴더 첨부" : "Attach folder", icon: <IconFolderOpenOutlineRegular size={16} /> },
    { id: "terminal", label: <><span>{ko ? "WindowsTerminal 내용 첨부" : "Attach terminal text"}</span><small>{ko ? "복사한 터미널 출력을 붙여넣습니다" : "Paste copied terminal output"}</small></>, icon: <span aria-hidden>›_</span> },
    { id: "goal", label: <><span>{ko ? "목표" : "Goal"}</span><small>{ko ? "계속 추구할 목표를 설정합니다" : "Set a durable objective"}</small></>, icon: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" /><circle cx="8" cy="8" r="2.5" fill="none" stroke="currentColor" /></svg> },
    { id: "plan", disabled: !skills.some(skill => skill.name === "ulw-plan"), label: <><span>{ko ? "계획 모드" : "Plan mode"}</span><small>{plan ? (ko ? "다음 요청의 계획 선택 해제" : "Remove plan from next request") : (ko ? "ULW 계획 워크플로 · 구현은 별도 시작" : "ULW planning · implementation starts separately")}</small></>, icon: <IconPlanOutlineRegular size={16} /> },
    { id: "sketch", label: ko ? "스케치 그리기" : "Draw a sketch", icon: <IconEditOutlineRegular size={16} /> },
    { type: "separator", id: "skills-separator" },
    { type: "label", id: "skills-label", text: ko ? "설치된 스킬" : "Installed skills" },
    ...skills.map(skill => ({ id: `skill:${skill.name}`, label: <><span>{skill.interface?.displayName ?? skill.name}</span><small>{skillSummary(skill)}</small></>, icon: <IconSkillOutlineRegular size={16} /> })),
  ];
  if (skills.length === 0) entries.push({ type: "label", id: "skills-status", text: loading ? (ko ? "스킬 불러오는 중…" : "Loading skills…") : (ko ? "설치된 스킬 없음" : "No installed skills") });
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
    anchor={<button type="button" className={css.trigger} data-testid="composer-add" aria-label={ko ? "추가" : "Add"}
      aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => { if (!open) onOpen(); setOpen(!open); }}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
    </button>} />;
}
