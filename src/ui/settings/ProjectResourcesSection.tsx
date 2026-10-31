import { useEffect, useState } from "react";
import { useAppSelector } from "../app-context";
import type { ProjectResources } from "../../../shared/project-resources";
import { RESOURCE_KINDS } from "../../../shared/project-resources";
import { useLocale } from "../../i18n";
import { ErrorText, SettingsGroup, ui } from "./SettingsCard";

type Result = { cwd: string; data: ProjectResources | null; error: boolean };

export function ProjectResourcesSection() {
  const ko = useLocale() === "ko";
  const threadId = useAppSelector(state => state.activeThreadId);
  const cwd = useAppSelector(state => threadId === null ? null : state.threads[threadId]?.cwd ?? null);
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    if (cwd === null || threadId === null) return;
    let active = true;
    void window.omo.readProjectResources(threadId).then(
      data => { if (active) setResult({ cwd, data, error: false }); },
      () => { if (active) setResult({ cwd, data: null, error: true }); },
    );
    return () => { active = false; };
  }, [cwd, threadId]);
  const current = result?.cwd === cwd ? result : null;
  const data = current?.data ?? null;
  const trust = data?.trust;
  const kinds = {
    packages: ko ? "패키지" : "Packages",
    extensions: ko ? "확장" : "Extensions",
    skills: ko ? "스킬" : "Skills",
    prompts: ko ? "프롬프트" : "Prompts",
    themes: ko ? "테마" : "Themes",
  };
  const origins = {
    direct: ko ? "직접 결정" : "Direct decision",
    ancestor: ko ? "상위 폴더 결정" : "Ancestor decision",
    default: ko ? "기본값" : "Default",
  };
  return <section className={ui.section} data-testid="project-resources" aria-busy={cwd !== null && current === null}>
    <SettingsGroup
      title={ko ? "프로젝트 신뢰 및 리소스" : "Project trust and resources"}
      intro={ko
        ? "파일의 읽기 전용 근거입니다. 실행 중인 세션의 결정이나 설치·로드 상태를 보장하지 않습니다."
        : "Read-only file evidence; it does not guarantee the running session decision or installed/loaded state."}
    />
    {cwd === null && <p className={ui.muted}>{ko ? "프로젝트를 선택하세요." : "Select a project."}</p>}
    {cwd !== null && current === null && <p className={ui.muted} role="status">{ko ? "불러오는 중..." : "Loading..."}</p>}
    {current?.error && <ErrorText>{ko ? "리소스 근거를 읽을 수 없습니다." : "Could not read resource evidence."}</ErrorText>}
    {data !== null && trust !== undefined && <>
      <article className={ui.card}><div className={ui.cardBody}>
        <h3 className={ui.heading}>{ko ? "신뢰 근거" : "Trust evidence"}</h3>
        <p className={ui.text}>{origins[trust.kind]} · {trust.trusted === null ? (ko ? "결정되지 않음" : "Undecided") : trust.trusted
          ? (ko ? "신뢰" : "Trusted")
          : (ko ? "신뢰하지 않음" : "Not trusted")}</p>
        {trust.defaultValue !== null && <p className={ui.muted}>{ko ? "비대화형 기본값" : "Non-interactive default"}: {trust.defaultValue}</p>}
        {trust.matchedDirectory !== null && <p className={`${ui.muted} wrap-anywhere`}>{trust.matchedDirectory}</p>}
        <p className={`${ui.muted} wrap-anywhere`}>{trust.path}</p>
      </div></article>
      {data.sources.map(source => <article className={ui.card} key={source.scope}>
        <div className={ui.cardBody}>
          <h3 className={ui.heading}>{source.scope === "global"
            ? (ko ? "전역 선언" : "Global declarations")
            : (ko ? "프로젝트 선언" : "Project declarations")}</h3>
          <p className={`${ui.muted} wrap-anywhere`}>{source.path}</p>
          {!source.exists && <p className={ui.muted}>{ko ? "설정 파일 없음" : "Settings file absent"}</p>}
          {RESOURCE_KINDS.map(kind => <div key={kind}>
            <h4 className={ui.subheading}>{kinds[kind]}</h4>
            {source.declarations[kind].length === 0
              ? <p className={ui.muted}>{ko ? "선언 없음" : "No declarations"}</p>
              : <ul className="m-0 pl-5">
                  {source.declarations[kind].map((entry, index) =>
                    <li className={`${ui.text} wrap-anywhere`} key={index}>
                      <code>{typeof entry === "string" ? entry : JSON.stringify(entry)}</code>
                    </li>)}
                </ul>}
          </div>)}
        </div>
      </article>)}
    </>}
  </section>;
}
