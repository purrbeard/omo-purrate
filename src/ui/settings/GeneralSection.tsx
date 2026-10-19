import { useState } from "react";
import { X } from "lucide-react";
import { Button, IconButton } from "../kit";
import type { Preferences } from "../../../shared/ipc";
import { useT } from "../../i18n";
import { TESTID } from "../testids";
import { uiState, updatePreferences, useUiState } from "../ui-state";
import { BehaviorSettings } from "./BehaviorSettings";
import { errorMessage } from "./diagnostics";
import { ErrorText, SettingsCard, SettingsGroup, SettingsRow, selectClass, ui } from "./SettingsCard";

async function savePreferences(patch: Partial<Preferences>): Promise<void> {
  const previous = uiState.get().preferences;
  if (previous !== null) uiState.setPreferences({ ...previous, ...patch });
  try {
    await updatePreferences(patch);
  } catch (error) {
    if (previous !== null) uiState.setPreferences(previous);
    throw error;
  }
}

function baseName(dir: string): string {
  const parts = dir.split(/[\\/]/).filter((part) => part !== "");
  return parts[parts.length - 1] ?? dir;
}

export function GeneralSection() {
  const t = useT();
  const { preferences } = useUiState();
  const [error, setError] = useState<string | null>(null);
  const lastWorkspace = preferences?.lastWorkspace ?? null;
  const recent = preferences?.recentWorkspaces ?? [];

  const save = (patch: Partial<Preferences>): void => {
    savePreferences(patch).then(
      () => setError(null),
      (reason: unknown) => setError(errorMessage(reason)),
    );
  };

  const removeRecent = (dir: string): void => {
    const nextRecent = recent.filter((entry) => entry !== dir);
    const patch: Partial<Preferences> = { recentWorkspaces: nextRecent };
    if (lastWorkspace === dir) patch.lastWorkspace = null;
    save(patch);
  };

  return (
    <section className={ui.section}>
      <SettingsGroup title={t("shell.settings.nav.general")} intro={t("shell.settings.general.intro")} />
      <BehaviorSettings />
      <SettingsCard>
        <SettingsRow title={t("shell.settings.general.workspace")} description={t("shell.settings.general.workspaceHint")}>
          <select
            className={selectClass}
            data-testid={TESTID.settingsWorkspaceDefault}
            aria-label={t("shell.settings.general.workspace")}
            disabled={preferences === null}
            value={lastWorkspace ?? ""}
            onChange={(event) => save({ lastWorkspace: event.target.value === "" ? null : event.target.value })}
          >
            <option value="">{t("shell.settings.general.workspaceAsk")}</option>
            {recent.map((dir) => (
              <option key={dir} value={dir}>
                {baseName(dir)}
              </option>
            ))}
          </select>
        </SettingsRow>
      </SettingsCard>
      <SettingsCard>
        <div className={ui.cardBody}>
          <div className={ui.heading}>{t("shell.settings.general.recent")}</div>
          <p className={ui.muted}>{t("shell.settings.general.recentHint")}</p>
          {recent.length === 0 ? (
            <p className={ui.muted}>{t("shell.settings.general.recentEmpty")}</p>
          ) : (
            recent.map((dir) => (
              <div className="-my-1 flex min-w-0 items-center gap-2" key={dir}>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={dir}>
                  {dir}
                </span>
                <IconButton
                  icon={<X aria-hidden="true" />}
                  data-testid={TESTID.settingsWorkspaceRemove}
                  label={t("shell.settings.general.removeWorkspace", { name: dir })}
                  onClick={() => removeRecent(dir)}
                />
              </div>
            ))
          )}
        </div>
        {recent.length > 0 && (
          <div className="flex justify-end pb-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => save({ recentWorkspaces: [], ...(lastWorkspace !== null ? { lastWorkspace: null } : {}) })}
            >
              {t("shell.settings.general.clearRecent")}
            </Button>
          </div>
        )}
      </SettingsCard>
      {error !== null && (
        <ErrorText>{t("shell.settings.saveFailed", { message: error })}</ErrorText>
      )}
    </section>
  );
}
