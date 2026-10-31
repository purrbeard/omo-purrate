import { useState } from "react";
import type { StorageCategory, StorageUsage } from "../../../shared/storage";
import { useLocale } from "../../i18n";
import { Button } from "../kit";
import { SectionHeading } from "./SectionHeading";
import { ErrorText, ui } from "./SettingsCard";

export function StorageSection({ load }: { load(days: number): Promise<StorageUsage> }) {
  const locale = useLocale();
  const ko = locale === "ko";
  const [days, setDays] = useState(30);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const labels: Record<StorageCategory, string> = {
    sessions: ko ? "세션" : "Sessions",
    attachments: ko ? "첨부 파일" : "Attachments",
    screenshots: ko ? "스크린샷" : "Screenshots",
  };
  const refresh = async () => {
    setBusy(true);
    setError(false);
    setUsage(null);
    try {
      setUsage(await load(days));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const number = (value: number) => value.toLocaleString(locale);
  return <section className={ui.section} data-testid="settings-storage" aria-busy={busy}>
    <SectionHeading
      title={ko ? "저장소" : "Storage"}
      intro={ko ? "확인된 로컬 폴더의 읽기 전용 미리보기입니다. 파일을 삭제하지 않습니다." : "Read-only preview of known local folders. No files are deleted."}
    />
    <article className={ui.card}><div className={ui.cardBody}>
      <label className={ui.text}>
        {ko ? "후보 기준 기간" : "Candidate age"}
        {" "}
        <select className={ui.control} value={days} disabled={busy} onChange={(event) => {
          setDays(Number(event.target.value));
          setUsage(null);
          setError(false);
        }}>
          {[30, 90, 180, 365].map((value) => <option key={value} value={value}>{value} {ko ? "일" : "days"}</option>)}
        </select>
      </label>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void refresh()}>
        {busy ? (ko ? "조회 중..." : "Loading...") : (ko ? "새로고침" : "Refresh")}
      </Button>
      {error && <ErrorText>{ko ? "저장소를 조회하지 못했습니다." : "Could not load storage usage."}</ErrorText>}
      {usage && <>
        <p className={ui.muted}>
          {ko ? `${usage.olderThanDays}일보다 오래된 파일은 삭제 대상이 아닌 후보입니다.` : `Files older than ${usage.olderThanDays} days are candidates, not deletions.`}
        </p>
        {usage.incomplete && <p role="status" className={ui.muted}>{ko ? "일부 결과가 누락되었습니다." : "Results are incomplete."}</p>}
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-140 text-left text-sm tabular-nums">
            <thead><tr>
              <th scope="col">{ko ? "범주" : "Category"}</th>
              <th scope="col">{ko ? "파일" : "Files"}</th>
              <th scope="col">{ko ? "바이트" : "Bytes"}</th>
              <th scope="col">{ko ? "후보 파일" : "Candidate files"}</th>
              <th scope="col">{ko ? "후보 바이트" : "Candidate bytes"}</th>
              <th scope="col">{ko ? "상태" : "Status"}</th>
            </tr></thead>
            <tbody>{usage.rows.map((row) => <tr key={row.category}>
              <th scope="row">{labels[row.category]}</th>
              <td>{row.state === "present" ? number(row.count) : "—"}</td>
              <td>{row.state === "present" ? number(row.bytes) : "—"}</td>
              <td>{row.state === "present" ? number(row.candidateCount) : "—"}</td>
              <td>{row.state === "present" ? number(row.candidateBytes) : "—"}</td>
              <td>
                {row.state === "absent" ? (ko ? "폴더 없음" : "Absent") : row.state === "unavailable" ? (ko ? "사용 불가" : "Unavailable") : (ko ? "확인됨" : "Present")}
                {` · ${ko ? "제외" : "Skipped"} ${number(row.skipped)} · ${ko ? "오류" : "Errors"} ${number(row.errors)}`}
                {row.incomplete && ` · ${ko ? "불완전" : "Incomplete"}`}
              </td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className={ui.muted}>{ko ? "하드 링크는 경로별로 집계되며, 조회 중 변경된 파일은 결과에 반영되지 않을 수 있습니다." : "Hard links are counted per path; changes during the scan may not be reflected."}</p>
      </>}
    </div></article>
  </section>;
}
