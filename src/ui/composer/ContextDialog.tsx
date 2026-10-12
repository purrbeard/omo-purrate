import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalLayer } from "@deepseek-ai/dsh-client-ui-primitives";
import { useT } from "../../i18n";
import css from "./ContextDialog.module.css";

export function ContextDialog({ kind, onAccept, onClose }: {
  kind: "terminal" | "goal";
  onAccept: (text: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const dialog = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  useModalLayer(dialog, true, onClose);
  const title = kind === "terminal" ? t("composer.context.terminalTitle") : t("composer.context.goalTitle");
  return createPortal(<div className={css.backdrop} onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} className={css.dialog} role="dialog" aria-modal="true" aria-labelledby="context-dialog-title" data-testid="context-dialog">
      <h2 id="context-dialog-title">{title}</h2>
      <p>{kind === "terminal" ? t("composer.context.terminalBody") : t("composer.context.goalBody")}</p>
      <textarea data-modal-autofocus aria-label={title} data-testid="context-dialog-input" value={text} maxLength={100000}
        onChange={event => setText(event.target.value)} placeholder={kind === "terminal" ? t("composer.context.terminalPlaceholder") : t("composer.context.goalPlaceholder")} />
      {error !== "" && <p role="alert">{error}</p>}
      <footer>
        {kind === "terminal" && <button type="button" onClick={() => { void window.omo.readClipboardText().then(value => { setText(value.slice(0, 100000)); setError(value === "" ? t("composer.context.clipboardEmpty") : ""); }, error => setError(String(error))); }}>{t("composer.context.paste")}</button>}
        <span />
        <button type="button" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className={css.primary} disabled={text.trim() === ""} onClick={() => onAccept(text.trim())}>{kind === "terminal" ? t("composer.context.attach") : t("composer.context.addGoal")}</button>
      </footer>
    </div>
  </div>, document.body);
}
