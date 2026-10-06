// Ported from DSH ui-settings-general SettingsRoot.tsx (MIT, Copyright (c) 2026 DeepSeek).
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  IconCloseOutlineRegular,
  IconDataOutlineMedium,
  IconInfoOutlineMedium,
  IconSettingsOutlineMedium,
  useModalLayer,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { useT } from "../../i18n";
import { TESTID } from "../testids";
import { uiState, useUiState } from "../ui-state";
import { AboutSection } from "./AboutSection";
import { AccountsSection } from "./AccountsSection";
import { GeneralSection } from "./GeneralSection";
import { OmoSection } from "./OmoSection";
import { IphoneSection } from "./IphoneSection";
import { McpSection } from "./McpSection";
import css from "./SettingsDialog.module.css";

type SectionId = "general" | "omo" | "accounts" | "mcp" | "iphone" | "about";

const SECTIONS: readonly SectionId[] = ["general", "omo", "accounts", "mcp", "iphone", "about"];

function NavIcon({ section }: { section: SectionId }) {
  switch (section) {
    case "general":
      return <IconSettingsOutlineMedium className={css.navIcon} size={16} />;
    case "iphone":
    case "accounts":
    case "mcp":
    case "omo":
      return <IconDataOutlineMedium className={css.navIcon} size={16} />;
    case "about":
      return <IconInfoOutlineMedium className={css.navIcon} size={16} />;
  }
}

function SettingsPanel({ section, onSelect, onClose }: { section: SectionId; onSelect(section: SectionId): void; onClose(): void }) {
  const t = useT();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useModalLayer(panel, true, onClose);

  return createPortal(
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className={css.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={TESTID.settingsDialog}
      >
        <nav className={css.nav} aria-label={t("shell.settings.sections")}>
          <h2 className={css.navTitle} id={titleId}>
            {t("shell.settings.title")}
          </h2>
          <div className={css.navList}>
            {SECTIONS.map((id) => (
              <button
                key={id}
                type="button"
                className={clsx(css.navCell, id === section && css.active)}
                aria-current={id === section ? "true" : undefined}
                data-section={id}
                data-modal-autofocus={id === section ? "" : undefined}
                onClick={() => onSelect(id)}
              >
                <NavIcon section={id} />
                <span className={css.navLabel}>{t(`shell.settings.nav.${id}`)}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className={css.content}>
          <div className={css.header}>
            <button type="button" className={css.close} aria-label={t("common.close")} onClick={onClose}>
              <IconCloseOutlineRegular size={14} />
            </button>
          </div>
          <div className={css.options}>
            {section === "general" && <GeneralSection />}
            {section === "omo" && <OmoSection />}
            {section === "accounts" && <AccountsSection />}
            {section === "mcp" && <McpSection />}
            {section === "iphone" && <IphoneSection />}
            {section === "about" && <AboutSection />}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function SettingsDialog() {
  const { settingsOpen } = useUiState();
  const [section, setSection] = useState<SectionId>("general");
  if (!settingsOpen) return null;
  return <SettingsPanel section={section} onSelect={setSection} onClose={() => uiState.setSettingsOpen(false)} />;
}
