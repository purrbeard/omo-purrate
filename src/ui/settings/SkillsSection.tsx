import { useEffect } from "react";
import { useT } from "../../i18n";
import { selectActiveCwd, selectSkillCatalog } from "../../state";
import { useActions, useAppSelector } from "../app-context";
import { TESTID } from "../testids";
import { ErrorText, SettingsCard, SettingsGroup, ui } from "./SettingsCard";

export function SkillsSection() {
  const t = useT();
  const actions = useActions();
  const cwd = useAppSelector(selectActiveCwd);
  const catalog = useAppSelector((state) => (cwd === null ? null : selectSkillCatalog(state, cwd)));
  useEffect(() => {
    if (cwd !== null) void actions.ensureSkills(cwd);
  }, [actions, cwd]);

  if (cwd === null) {
    return (
      <section className={ui.section}>
        <SettingsGroup title={t("shell.settings.nav.skills")} intro={t("shell.settings.skills.intro")} />
        <SettingsCard>
          <div className={ui.cardBody}>
            <p className={ui.muted}>{t("shell.settings.skills.noWorkspace")}</p>
          </div>
        </SettingsCard>
      </section>
    );
  }

  return (
    <section className={ui.section} aria-busy={catalog?.status === "loading"}>
      <SettingsGroup title={t("shell.settings.nav.skills")} intro={t("shell.settings.skills.intro")} />
      {catalog?.status === "error" && (
        <ErrorText>{t("shell.settings.skills.error", { message: catalog.errors.map((entry) => entry.message).join("; ") })}</ErrorText>
      )}
      {(catalog === null || catalog.status === "idle" || catalog.status === "loading") && (
        <p className={ui.muted}>{t("shell.settings.skills.loading")}</p>
      )}
      {catalog?.status === "ready" && catalog.skills.length === 0 && (
        <SettingsCard>
          <div className={ui.cardBody}>
            <p className={ui.muted}>{t("shell.settings.skills.empty")}</p>
          </div>
        </SettingsCard>
      )}
      {catalog?.status === "ready" && catalog.skills.length > 0 && (
        <SettingsCard>
          <div className={ui.cardBody}>
            {catalog.skills.map((skill) => (
              <div key={skill.name} className="flex items-center gap-3 border-0 border-solid border-border py-2.5 first:pt-0 last:pb-0 [&+&]:border-t" data-testid={TESTID.settingsSkillRow}>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="text-sm leading-5 text-foreground">
                    <code className={ui.mono}>{skill.name}</code>
                  </div>
                  <div className="text-xs leading-4.5 text-muted-foreground">{skill.shortDescription ?? skill.description}</div>
                </div>
                <span className={ui.badge}>{t(`shell.settings.skills.scope.${skill.scope}`)}</span>
              </div>
            ))}
          </div>
        </SettingsCard>
      )}
    </section>
  );
}
