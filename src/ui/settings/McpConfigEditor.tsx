import { useEffect, useRef, useState } from "react";
import type { McpScope, McpSummary } from "../../../shared/mcp-settings";
import { useLocale } from "../../i18n";
import { useAppSelector } from "../app-context";
import { Button } from "../kit";
import { ErrorText, SettingsCard, ui } from "./SettingsCard";

export function McpConfigEditor() {
  const ko = useLocale() === "ko";
  const threadId = useAppSelector(state => state.activeThreadId);
  const [scope, setScope] = useState<McpScope>("global");
  const [items, setItems] = useState<McpSummary[]>([]);
  const [fileRevision, setFileRevision] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<McpSummary | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [replaceArgs, setReplaceArgs] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    generation.current++;
    setLoading(true); setItems([]); setFileRevision(""); setError(false); reset(); setType("stdio"); setSaved(false); setBusy(false);
    void window.omo.loadMcpSettings(scope, threadId).then(value => { if (active) { setItems(value.servers); setFileRevision(value.revision); } }, () => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [scope, threadId, revision]);
  const reset = (): void => { setEditing(null); setName(""); setCommand(""); setArgs(""); setReplaceArgs(false); setEnabled(false); };
  return <SettingsCard testId="mcp-editor" aria-busy={loading || busy}>
    <div className={ui.cardBody}>
      <h3 className={ui.heading}>{ko ? "로컬 서버 설정" : "Local server settings"}</h3>
      <p className={ui.muted}>{ko ? "저장은 자동으로 연결하거나 프로젝트를 신뢰하지 않습니다. 적용하려면 실행 중인 턴을 마친 뒤 런타임에서 재연결하세요. 비밀값 대신 환경 변수·파일 참조를 기존 설정에 유지합니다." : "Saving does not connect or grant project trust. Finish running turns, then reconnect the runtime to apply. Existing environment/file references are preserved."}</p>
      <label>{ko ? "범위" : "Scope"} <select className={ui.control} data-testid="mcp-editor-scope" value={scope} disabled={busy} onChange={event => setScope(event.target.value === "project" ? "project" : "global")}>
        <option value="global">{ko ? "전역" : "Global"}</option><option value="project" disabled={threadId === null}>{ko ? "프로젝트" : "Project"}</option>
      </select></label>
      {items.map(item => <div key={item.name} className="flex min-w-0 flex-wrap items-center gap-2"><span className={`${ui.text} min-w-0 flex-1 wrap-anywhere`}>{item.name} · {item.type} · {item.enabled ? (ko ? "사용" : "Enabled") : (ko ? "꺼짐" : "Disabled")}</span>
        <Button size="sm" variant="outline" disabled={busy || loading} onClick={() => { setEditing(item); setName(item.name); setType(item.type); setEnabled(item.enabled); setCommand(""); setArgs(""); setReplaceArgs(false); }}>{ko ? "편집" : "Edit"}</Button>
        <Button size="sm" variant="outline" disabled={busy || loading} onClick={() => {
          const requestGeneration = generation.current;
          setBusy(true); setError(false);
          void window.omo.saveMcpSettings(scope, threadId, { ...item, revision: fileRevision, mode: "update", remove: true }).then(() => { if (requestGeneration === generation.current) setRevision(value => value + 1); }, () => { if (requestGeneration === generation.current) setError(true); }).finally(() => { if (requestGeneration === generation.current) setBusy(false); });
        }}>{ko ? "백업 후 설정에서 제외" : "Back up and remove from config"}</Button>
      </div>)}
      {!loading && items.length === 0 && <p className={ui.muted}>{ko ? "설정된 서버가 없습니다." : "No configured servers."}</p>}
      <form className="flex min-w-0 flex-col gap-3" onSubmit={event => {
        event.preventDefault(); setBusy(true); setError(false); setSaved(false);
        const requestGeneration = generation.current;
        const replacement = command.trim();
        void window.omo.saveMcpSettings(scope, threadId, { revision: fileRevision, mode: editing === null ? "create" : "update", name, type, enabled,
          ...(replacement ? type === "stdio" ? { command: replacement } : { url: replacement } : {}),
          ...(type === "stdio" && replaceArgs ? { args: args === "" ? [] : args.split(/\r?\n/) } : {}),
        }).then(() => { if (generation.current === requestGeneration) { reset(); setRevision(value => value + 1); setSaved(true); } }, () => { if (generation.current === requestGeneration) setError(true); }).finally(() => { if (generation.current === requestGeneration) setBusy(false); });
      }}>
        <label className="flex min-w-0 flex-col gap-1">{ko ? "서버 이름" : "Server name"}<input className={ui.control} data-testid="mcp-editor-name" value={name} disabled={editing !== null || loading || busy} required onChange={event => setName(event.target.value)} /></label>
        <label>{ko ? "종류" : "Type"} <select className={ui.control} data-testid="mcp-editor-type" value={type} disabled={editing !== null || loading || busy} onChange={event => setType(event.target.value === "http" ? "http" : "stdio")}><option value="stdio">stdio</option><option value="http">HTTP</option></select></label>
        <label className="flex min-w-0 flex-col gap-1">{type === "stdio" ? (ko ? "실행 명령" : "Command") : "HTTP URL"}{editing && (ko ? " (빈 값은 기존 설정 유지)" : " (blank keeps existing)")}<input className={ui.control} data-testid="mcp-editor-command" value={command} required={editing === null} disabled={loading || busy} autoComplete="off" onChange={event => setCommand(event.target.value)} /></label>
        {type === "stdio" && <><label><input type="checkbox" checked={replaceArgs} disabled={loading || busy} onChange={event => setReplaceArgs(event.target.checked)} /> {ko ? "인자 교체" : "Replace arguments"}</label>{replaceArgs && <textarea className={`${ui.field} min-h-20 p-2`} aria-label={ko ? "한 줄에 인자 하나" : "One argument per line"} value={args} disabled={loading || busy} onChange={event => setArgs(event.target.value)} />}</>}
        <label><input data-testid="mcp-editor-enabled" type="checkbox" checked={enabled} disabled={loading || busy} onChange={event => setEnabled(event.target.checked)} /> {ko ? "사용" : "Enabled"}</label>
        <div className="flex flex-wrap gap-2"><Button variant="primary" type="submit" data-testid="mcp-editor-save" disabled={loading || busy}>{ko ? "저장" : "Save"}</Button>{editing && <Button variant="outline" disabled={busy} onClick={reset}>{ko ? "편집 취소" : "Cancel edit"}</Button>}</div>
      </form>
      {saved && <p role="status" data-testid="mcp-editor-saved" className={ui.muted}>{ko ? "저장했습니다. 재연결 후 적용됩니다." : "Saved. Reconnect to apply."}</p>}
      {error && <ErrorText>{ko ? "설정을 읽거나 저장하지 못했습니다. 값을 확인하고 다시 불러오세요." : "Could not read or save settings. Check values and reload."}</ErrorText>}
      <Button variant="outline" size="sm" disabled={busy} onClick={() => setRevision(value => value + 1)}>{ko ? "다시 불러오기" : "Reload"}</Button>
    </div>
  </SettingsCard>;
}
