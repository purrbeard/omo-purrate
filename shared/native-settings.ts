export type NativeSettingsScope = "global" | "project";

/** Only documented, allowlisted settings are included in this object. */
export type NativeSettingsValues = Record<string, unknown>;

export interface NativeSettingsSnapshot {
  scope: NativeSettingsScope;
  configPath: string;
  revision: string;
  values: NativeSettingsValues;
}

export interface NativeSettingsInput {
  scope: NativeSettingsScope;
  revision: string;
  /** Omitted fields are unchanged. Model overrides merge by model and field. */
  values: NativeSettingsValues;
}
