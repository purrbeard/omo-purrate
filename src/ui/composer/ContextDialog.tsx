import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalLayer } from "@deepseek-ai/dsh-client-ui-primitives";
import { useT } from "../../i18n";
import { Button } from "../kit";

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
  return createPortal(<div className="fixed inset-0 z-[1000] grid place-items-center bg-black/40 p-5" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} className="box-border max-h-[calc(100vh-40px)] w-full max-w-[620px] overflow-auto rounded-2xl border border-solid border-border bg-popover p-5 text-popover-foreground shadow-lg" role="dialog" aria-modal="true" aria-labelledby="context-dialog-title" data-testid="context-dialog">
      <h2 id="context-dialog-title" className="m-0 mb-2 text-base font-semibold">{title}</h2>
      <p className="m-0 mb-4 text-[13px] leading-5 text-muted-foreground">{kind === "terminal" ? t("composer.context.terminalBody") : t("composer.context.goalBody")}</p>
      <textarea className="box-border h-56 w-full resize-y rounded-lg border border-solid border-input bg-composer p-3 font-mono text-[13px] leading-5 text-composer-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" data-modal-autofocus aria-label={title} data-testid="context-dialog-input" value={text} maxLength={100000}
        onChange={event => setText(event.target.value)} placeholder={kind === "terminal" ? t("composer.context.terminalPlaceholder") : t("composer.context.goalPlaceholder")} />
      {error !== "" && <p className="m-0 mt-2 text-[13px] leading-5 text-destructive-foreground" role="alert">{error}</p>}
      <footer className="mt-4 flex flex-wrap items-center gap-2">
        {kind === "terminal" && <Button variant="outline" size="sm" onClick={() => { void window.omo.readClipboardText().then(value => { setText(value.slice(0, 100000)); setError(value === "" ? t("composer.context.clipboardEmpty") : ""); }, error => setError(String(error))); }}>{t("composer.context.paste")}</Button>}
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" size="sm" disabled={text.trim() === ""} onClick={() => onAccept(text.trim())}>{kind === "terminal" ? t("composer.context.attach") : t("composer.context.addGoal")}</Button>
      </footer>
    </div>
  </div>, document.body);
}
