import { useState } from "react";
import clsx from "clsx";
import type { FollowUpPreference, Preferences, SendKeyPreference, ThreadNotificationPreference, TimeFormatPreference } from "../../../shared/ipc";
import { useT } from "../../i18n";
import { TESTID } from "../testids";
import { uiState, updatePreferences, useUiState } from "../ui-state";
import { errorMessage } from "./diagnostics";
import { ErrorText, Segmented, SettingsCard, SettingsGroup, SettingsRow, Toggle, ui } from "./SettingsCard";

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

/**
 * The General settings groups for thread behaviour: "Organization" (auto-settle and its days) and "Behavior"
 * (thread notifications, in-app notifications, time format). Self-contained so a different settings surface
 * can mount it unchanged.
 */
export function BehaviorSettings() {
  const t = useT();
  const { preferences } = useUiState();
  const [error, setError] = useState<string | null>(null);

  const save = (patch: Partial<Preferences>): void => {
    savePreferences(patch).then(
      () => setError(null),
      (reason: unknown) => setError(errorMessage(reason)),
    );
  };

  const autoSettle = preferences?.autoSettle ?? true;
  const autoSettleDays = preferences?.autoSettleDays ?? 3;
  const threadNotifications = preferences?.threadNotifications ?? "background";
  const inAppNotifications = preferences?.inAppNotifications ?? true;
  const timeFormat = preferences?.timeFormat ?? "system";
  const sendKey = preferences?.sendKey ?? "enter";
  const followUpBehavior = preferences?.followUpBehavior ?? "steer";
  const keywordEffects = preferences?.keywordEffects ?? true;
  const showContextUsage = preferences?.showContextUsage ?? true;
  const openWorkflowOnRun = preferences?.openWorkflowOnRun ?? false;

  return (
    <>
      <SettingsGroup title={t("shell.settings.group.organization")} />
      <SettingsCard>
        <SettingsRow title={t("shell.settings.autoSettle")} description={t("shell.settings.autoSettle.hint")}>
          <Toggle testId={TESTID.settingsAutoSettle} checked={autoSettle} label={t("shell.settings.autoSettle")} disabled={preferences === null} onChange={() => save({ autoSettle: !autoSettle })} />
        </SettingsRow>
        <SettingsRow title={t("shell.settings.autoSettleDays")} description={t("shell.settings.autoSettleDays.hint")}>
          <input
            type="number"
            className={clsx(ui.control, "w-18 text-right")}
            data-testid={TESTID.settingsAutoSettleDays}
            aria-label={t("shell.settings.autoSettleDays")}
            min={1}
            max={365}
            step={1}
            value={autoSettleDays}
            disabled={!autoSettle || preferences === null}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value !== autoSettleDays) save({ autoSettleDays: value });
            }}
          />
        </SettingsRow>
        {error !== null && (
          <ErrorText className="pb-4">{t("shell.settings.saveFailed", { message: error })}</ErrorText>
        )}
      </SettingsCard>
      <SettingsGroup title={t("shell.settings.group.behavior")} />
      <SettingsCard>
        <SettingsRow title={t("shell.settings.threadNotifications")} description={t("shell.settings.threadNotifications.hint")}>
          <div data-testid={TESTID.settingsThreadNotifications}>
            <Segmented<ThreadNotificationPreference>
              label={t("shell.settings.threadNotifications")}
              value={threadNotifications}
              options={[
                { value: "off", label: t("shell.settings.threadNotifications.off") },
                { value: "background", label: t("shell.settings.threadNotifications.background") },
                { value: "always", label: t("shell.settings.threadNotifications.always") },
              ]}
              onChange={(next) => save({ threadNotifications: next })}
            />
          </div>
        </SettingsRow>
        <SettingsRow title={t("shell.settings.inAppNotifications")} description={t("shell.settings.inAppNotifications.hint")}>
          <Toggle testId={TESTID.settingsInAppNotifications} checked={inAppNotifications} label={t("shell.settings.inAppNotifications")} disabled={preferences === null} onChange={() => save({ inAppNotifications: !inAppNotifications })} />
        </SettingsRow>
        <SettingsRow title={t("shell.settings.timeFormat")} description={t("shell.settings.timeFormat.hint")}>
          <div data-testid={TESTID.settingsTimeFormat}>
            <Segmented<TimeFormatPreference>
              label={t("shell.settings.timeFormat")}
              value={timeFormat}
              options={[
                { value: "system", label: t("shell.settings.timeFormat.system") },
                { value: "12h", label: t("shell.settings.timeFormat.12h") },
                { value: "24h", label: t("shell.settings.timeFormat.24h") },
              ]}
              onChange={(next) => save({ timeFormat: next })}
            />
          </div>
        </SettingsRow>
        {error !== null && (
          <ErrorText className="pb-4">{t("shell.settings.saveFailed", { message: error })}</ErrorText>
        )}
      </SettingsCard>
      <SettingsGroup title={t("shell.settings.group.composer")} />
      <SettingsCard>
        <SettingsRow title={t("shell.settings.sendKey")} description={t("shell.settings.sendKey.hint")}>
          <div data-testid={TESTID.settingsSendKey}>
            <Segmented<SendKeyPreference>
              label={t("shell.settings.sendKey")}
              value={sendKey}
              options={[
                { value: "enter", label: t("shell.settings.sendKey.enter") },
                { value: "ctrlEnter", label: t("shell.settings.sendKey.ctrlEnter") },
              ]}
              onChange={(next) => save({ sendKey: next })}
            />
          </div>
        </SettingsRow>
        <SettingsRow title={t("shell.settings.followUp")} description={t("shell.settings.followUp.hint")}>
          <div data-testid={TESTID.settingsFollowUp}>
            <Segmented<FollowUpPreference>
              label={t("shell.settings.followUp")}
              value={followUpBehavior}
              options={[
                { value: "steer", label: t("shell.settings.followUp.steer") },
                { value: "queue", label: t("shell.settings.followUp.queue") },
              ]}
              onChange={(next) => save({ followUpBehavior: next })}
            />
          </div>
        </SettingsRow>
        <SettingsRow title={t("shell.settings.keywordEffects")} description={t("shell.settings.keywordEffects.hint")}>
          <Toggle testId={TESTID.settingsKeywordEffects} checked={keywordEffects} label={t("shell.settings.keywordEffects")} disabled={preferences === null} onChange={() => save({ keywordEffects: !keywordEffects })} />
        </SettingsRow>
        <SettingsRow title={t("shell.settings.showContextUsage")} description={t("shell.settings.showContextUsage.hint")}>
          <Toggle testId={TESTID.settingsShowContextUsage} checked={showContextUsage} label={t("shell.settings.showContextUsage")} disabled={preferences === null} onChange={() => save({ showContextUsage: !showContextUsage })} />
        </SettingsRow>
      </SettingsCard>
      <SettingsGroup title={t("shell.settings.group.workflow")} />
      <SettingsCard>
        <SettingsRow title={t("shell.settings.openWorkflowOnRun")} description={t("shell.settings.openWorkflowOnRun.hint")}>
          <Toggle testId={TESTID.settingsOpenWorkflowOnRun} checked={openWorkflowOnRun} label={t("shell.settings.openWorkflowOnRun")} disabled={preferences === null} onChange={() => save({ openWorkflowOnRun: !openWorkflowOnRun })} />
        </SettingsRow>
      </SettingsCard>
    </>
  );
}
