import type { ReactNode } from "react";
import css from "./SettingsDialog.module.css";

export function SectionHeading({ title, intro }: { title: string; intro: string }) {
  return (
    <header className={css.sectionHeading}>
      <h3 className={css.sectionTitle}>{title}</h3>
      <p className={css.sectionIntro}>{intro}</p>
    </header>
  );
}

export function SettingRow({ title, hint, children }: { title: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.rowTitle}>{title}</div>
        {hint !== undefined && <div className={css.rowHint}>{hint}</div>}
      </div>
      {children !== undefined && <div className={css.rowControl}>{children}</div>}
    </div>
  );
}
