import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalLayer } from "@deepseek-ai/dsh-client-ui-primitives";
import { useLocale } from "../../i18n";
import css from "./ContextDialog.module.css";

export function ContextDialog({ kind, onAccept, onClose }: {
  kind: "terminal" | "goal";
  onAccept: (text: string) => void;
  onClose: () => void;
}) {
  const ko = useLocale() === "ko";
  const dialog = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  useModalLayer(dialog, true, onClose);
  const title = kind === "terminal" ? (ko ? "WindowsTerminal 내용 첨부" : "Attach terminal text") : (ko ? "목표 설정" : "Set a goal");
  return createPortal(<div className={css.backdrop} onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} className={css.dialog} role="dialog" aria-modal="true" aria-labelledby="context-dialog-title" data-testid="context-dialog">
      <h2 id="context-dialog-title">{title}</h2>
      <p>{kind === "terminal" ? (ko ? "터미널에서 필요한 출력을 복사한 뒤 붙여넣으세요. 첨부 전 내용을 확인할 수 있습니다." : "Copy the output you need from your terminal, then paste and review it here.") : (ko ? "완료할 때까지 계속 추구할 목표를 작성하세요." : "Describe the objective to pursue until completion.")}</p>
      <textarea data-modal-autofocus aria-label={title} data-testid="context-dialog-input" value={text} maxLength={100000}
        onChange={event => setText(event.target.value)} placeholder={kind === "terminal" ? (ko ? "터미널 출력 붙여넣기" : "Paste terminal output") : (ko ? "달성할 결과를 입력하세요" : "Describe the desired outcome")} />
      {error !== "" && <p role="alert">{error}</p>}
      <footer>
        {kind === "terminal" && <button type="button" onClick={() => { void window.omo.readClipboardText().then(value => { setText(value.slice(0, 100000)); setError(value === "" ? (ko ? "클립보드에 텍스트가 없습니다." : "The clipboard has no text.") : ""); }, error => setError(String(error))); }}>{ko ? "클립보드에서 붙여넣기" : "Paste from clipboard"}</button>}
        <span />
        <button type="button" onClick={onClose}>{ko ? "취소" : "Cancel"}</button>
        <button type="button" className={css.primary} disabled={text.trim() === ""} onClick={() => onAccept(text.trim())}>{kind === "terminal" ? (ko ? "첨부" : "Attach") : (ko ? "목표 추가" : "Add goal")}</button>
      </footer>
    </div>
  </div>, document.body);
}
