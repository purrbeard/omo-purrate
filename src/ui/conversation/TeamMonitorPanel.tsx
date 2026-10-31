import { useEffect, useState } from "react";
import type { TeamSnapshot } from "../../../shared/team";
import { useLocale } from "../../i18n";
import { useAppSelector } from "../app-context";
import { Button } from "../kit";
import { ErrorText, ui } from "../settings/SettingsCard";

export function TeamMonitorPanel({ threadId }: { threadId: string }) {
  const ko = useLocale() === "ko";
  const monitors = useAppSelector(state => state.conversations[threadId]?.live.monitors);
  const connected = useAppSelector(state => state.bridge?.state === "connected");
  const [teams, setTeams] = useState<TeamSnapshot[] | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<{ team: string; member: string } | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    setError(false); setTeams(null);
    void window.omo.readTeams(threadId).then(value => { if (active) setTeams(value); }, () => { if (active) setError(true); });
    return () => { active = false; };
  }, [threadId, revision]);
  return <section className="flex min-w-0 flex-col gap-3 p-4" data-testid="team-monitor-panel">
    <h3 className={ui.heading}>{ko ? "팀" : "Teams"}</h3>
    <Button size="sm" variant="outline" onClick={() => setRevision(value => value + 1)}>{ko ? "새로고침" : "Refresh"}</Button>
    {error && <ErrorText>{ko ? "팀 상태를 읽지 못했습니다." : "Could not read teams."}</ErrorText>}
    {teams === null && !error && <p role="status">{ko ? "조회 중..." : "Loading..."}</p>}
    {teams?.length === 0 && <p className={ui.muted}>{ko ? "이 세션이 소유한 팀이 없습니다." : "No teams owned by this session."}</p>}
    {teams?.map(team => <article key={team.id} className="min-w-0 rounded-md border border-solid border-border p-3" data-team-id={team.id}>
      <h4 className={`${ui.heading} wrap-anywhere`}>{team.name} · {team.status}</h4>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 pt-2">{team.members.map(member => <li key={member.name} className="wrap-anywhere">{member.name} · {member.status}{member.model && <div className={ui.muted}>{member.model}</div>}
        <Button size="sm" variant="outline" disabled={busy || !connected} onClick={() => { setTarget({ team: team.id, member: member.name }); setMessage(""); }}>{ko ? "메시지" : "Message"}</Button>
      </li>)}</ul>
    </article>)}
    {target && <form className="flex min-w-0 flex-col gap-2" onSubmit={event => {
      event.preventDefault(); setBusy(true); setError(false);
      void window.omo.sendTeamMessage(threadId, target.team, target.member, message).then(() => { setTarget(null); setMessage(""); }, () => setError(true)).finally(() => setBusy(false));
    }}><label className={ui.text}>{target.member}<textarea className={`${ui.field} w-full p-2`} aria-label={ko ? "팀 메시지" : "Team message"} value={message} disabled={busy} onChange={event => setMessage(event.target.value)} /></label>
      <Button variant="primary" size="sm" type="submit" disabled={busy || !message.trim() || !connected}>{ko ? "보내기" : "Send"}</Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => setTarget(null)}>{ko ? "취소" : "Cancel"}</Button>
    </form>}
    <h3 className={ui.heading}>{ko ? "감시" : "Monitors"}</h3>
    {!connected && <p role="status" className={ui.muted}>{ko ? "연결이 끊겨 마지막 상태입니다." : "Disconnected; last known state."}</p>}
    {monitors === undefined ? <p className={ui.muted}>{ko ? "이 연결에서 감시 스냅샷을 아직 받지 못했습니다." : "No monitor snapshot received on this connection."}</p>
      : monitors.monitors.length === 0 ? <p className={ui.muted}>{ko ? "활성 감시가 없습니다." : "No active monitors."}</p>
      : <ul className="m-0 flex list-none flex-col gap-3 p-0">{monitors.monitors.map(monitor => <li key={monitor.id} className="wrap-anywhere" data-monitor-id={monitor.id}>{monitor.description} · {monitor.paused ? (ko ? "일시 중지" : "Paused") : (ko ? "실행 중" : "Running")}<div className={ui.muted}>{monitor.id}</div>
        <div className="flex flex-wrap gap-2">{(monitor.paused ? ["rearm", "stop"] as const : ["stop"] as const).map(action => <Button key={action} variant="outline" size="sm" disabled={busy || !connected} onClick={() => {
          setBusy(true); setError(false);
          void window.omo.request("extension_request", { threadId, name: "omo-ui.monitor.control", data: { id: monitor.id, action } }).catch(() => setError(true)).finally(() => setBusy(false));
        }}>{action === "stop" ? (ko ? "중지" : "Stop") : (ko ? "다시 감시" : "Rearm")}</Button>)}</div>
      </li>)}</ul>}
  </section>;
}
