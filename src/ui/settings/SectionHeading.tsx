import type { ReactNode } from "react";
import { SettingsGroup, SettingsRow } from "./SettingsCard";

/** Page heading of a settings section: title plus intro. */
export function SectionHeading({ title, intro, children }: { title: string; intro: string; children?: ReactNode }) {
  return <SettingsGroup title={title} intro={intro}>{children}</SettingsGroup>;
}

/** A settings row whose description is called `hint`. */
export function SettingRow({ title, hint, children }: { title: string; hint?: ReactNode; children?: ReactNode }) {
  return <SettingsRow title={title} description={hint}>{children}</SettingsRow>;
}
