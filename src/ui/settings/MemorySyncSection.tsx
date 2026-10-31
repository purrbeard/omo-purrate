import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../i18n";
import { useAppSelector } from "../app-context";
import { Button } from "../kit";
import { ErrorText, SettingsCard, ui } from "./SettingsCard";

export function MemorySyncSection() {
  const ko = useLocale() === "ko";
  const threadId = useAppSelector(state => state.activeThreadId);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  useEffect(() => { generation.current++; setStatus(null); setError(false); setBusy(false); }, [threadId]);
  return <SettingsCard testId="memory-sync"><div className={ui.cardBody}>
    <h3 className={ui.heading}>{ko ? "메모리 동기화 연결" : "Memory sync connection"}</h3>
    <p className={ui.muted}>{ko ? "동기화에는 로그인 계정에 귀속된 데스크톱 신뢰 채널과 서비스, 기기 승인 또는 복구 키가 필요합니다. 이 앱은 해당 채널을 우회하거나 CLI 계정으로 대체하지 않습니다." : "Sync requires an account-bound trusted desktop channel and service, plus device approval or a recovery key. This app does not bypass that channel or substitute a CLI account."}</p>
    <Button variant="outline" size="sm" data-testid="memory-sync-refresh" disabled={busy || threadId === null} onClick={() => {
      setBusy(true); setError(false); setStatus(null);
      const requestGeneration = generation.current;
      void window.omo.request("extension_request", { threadId: threadId ?? "", name: "omo.memory.sync.status", data: {} }).then(value => {
        if (generation.current !== requestGeneration) return;
        if (typeof value !== "object" || value === null || !("kind" in value) || typeof value.kind !== "string") throw new Error("Invalid sync status");
        setStatus(value.kind + ("reason" in value && typeof value.reason === "string" ? `: ${value.reason}` : ""));
      }).catch(() => { if (generation.current === requestGeneration) setError(true); }).finally(() => { if (generation.current === requestGeneration) setBusy(false); });
    }}>{ko ? "연결 상태 확인" : "Check connection"}</Button>
    {status && <p role="status" className={`${ui.text} wrap-anywhere`}>{status}</p>}
    {error && <ErrorText>{ko ? "이 세션에서 동기화 상태를 조회하지 못했습니다." : "Could not read sync status for this session."}</ErrorText>}
  </div></SettingsCard>;
}
