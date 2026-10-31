import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NativeSettingsInput,
  NativeSettingsScope,
  NativeSettingsSnapshot,
  NativeSettingsValues,
} from "../../../shared/native-settings";
import { useLocale } from "../../i18n";
import { useAppSelector } from "../app-context";
import { Button } from "../kit";
import { SettingRow } from "./SectionHeading";
import { ErrorText, SettingsCard, ui } from "./SettingsCard";

type Field = {
  group: string;
  key: string;
  en: string;
  ko: string;
  kind: "text" | "list" | "number" | "boolean" | "choice" | "overrides";
  choices?: string[];
};

const fields: Field[] = [
  { group: "", key: "defaultProvider", en: "Default provider", ko: "기본 제공자", kind: "text" },
  { group: "", key: "defaultModel", en: "Default model", ko: "기본 모델", kind: "text" },
  { group: "", key: "defaultThinkingLevel", en: "Default thinking level", ko: "기본 사고 수준", kind: "choice", choices: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] },
  { group: "", key: "favoriteModels", en: "Favorite models", ko: "즐겨찾는 모델", kind: "list" },
  { group: "", key: "enabledModels", en: "Enabled models (native TUI)", ko: "활성 모델 (네이티브 TUI)", kind: "list" },
  { group: "compaction", key: "enabled", en: "Auto compaction", ko: "자동 압축", kind: "boolean" },
  { group: "compaction", key: "reserveTokens", en: "Reserve tokens", ko: "예약 토큰", kind: "number" },
  { group: "compaction", key: "keepRecentTokens", en: "Recent tokens to keep", ko: "유지할 최근 토큰", kind: "number" },
  { group: "compaction", key: "summarizationMaxDurationMs", en: "Summary timeout (ms)", ko: "요약 제한 시간 (ms)", kind: "number" },
  { group: "compaction", key: "modelOverrides", en: "Model token overrides", ko: "모델별 토큰 설정", kind: "overrides" },
  { group: "compaction", key: "speculativeLeadTokens", en: "Speculative lead tokens", ko: "선행 압축 토큰", kind: "number" },
  { group: "compaction", key: "graceBandEnabled", en: "Grace band", ko: "유예 구간", kind: "boolean" },
  { group: "compaction", key: "reserveScalingEnabled", en: "Reserve scaling", ko: "예약량 조정", kind: "boolean" },
  { group: "compaction", key: "model", en: "Compaction model", ko: "압축 모델", kind: "text" },
  { group: "terminal", key: "notify", en: "Terminal notification", ko: "터미널 알림", kind: "choice", choices: ["wake", "next-turn", "off"] },
  { group: "terminal", key: "timeoutAction", en: "Terminal timeout action", ko: "터미널 시간 초과 동작", kind: "choice", choices: ["background", "kill"] },
  { group: "terminal", key: "defaultCols", en: "Terminal columns", ko: "터미널 열", kind: "number" },
  { group: "terminal", key: "defaultRows", en: "Terminal rows", ko: "터미널 행", kind: "number" },
  { group: "terminal", key: "scrollback", en: "Terminal scrollback", ko: "터미널 스크롤백", kind: "number" },
  { group: "terminal", key: "maxSessions", en: "Maximum terminal sessions", ko: "최대 터미널 세션", kind: "number" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldId(field: Field): string {
  return field.group ? `${field.group}.${field.key}` : field.key;
}

function get(values: NativeSettingsValues, field: Field): unknown {
  if (!field.group) return values[field.key];
  const group = values[field.group];
  return isRecord(group) ? group[field.key] : undefined;
}

function display(value: unknown, kind: Field["kind"]): string {
  if (value === undefined) return "";
  if (kind === "list" && Array.isArray(value)) return value.join("\n");
  if (kind === "overrides" && isRecord(value)) {
    return Object.entries(value).map(([name, row]) => {
      if (!isRecord(row)) return "";
      return `${name} | ${row["reserveTokens"] ?? ""} | ${row["keepRecentTokens"] ?? ""}`;
    }).filter(Boolean).join("\n");
  }
  return String(value);
}

function parseField(field: Field, raw: string): unknown {
  if (field.kind === "list") return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (field.kind === "overrides") {
    const result: Record<string, unknown> = Object.create(null);
    for (const line of raw.split(/\r?\n/).filter((item) => item.trim() !== "")) {
      const parts = line.split("|").map((part) => part.trim());
      const name = parts[0];
      const reserve = parts[1];
      const recent = parts[2];
      if (parts.length !== 3 || !name || reserve === undefined || recent === undefined
          || Object.hasOwn(result, name) || (!reserve && !recent)) throw new Error("Invalid override.");
      const row: Record<string, unknown> = {};
      if (reserve) row["reserveTokens"] = Number(reserve);
      if (recent) row["keepRecentTokens"] = Number(recent);
      result[name] = row;
    }
    return result;
  }
  if (raw.trim() === "") throw new Error("Empty value.");
  if (field.kind === "number") return Number(raw);
  if (field.kind === "boolean") {
    if (raw !== "true" && raw !== "false") throw new Error("Invalid boolean.");
    return raw === "true";
  }
  return raw;
}

function patch(drafts: Record<string, string>): NativeSettingsValues {
  const result: NativeSettingsValues = {};
  for (const field of fields) {
    const raw = drafts[fieldId(field)];
    if (raw === undefined) continue;
    const value = parseField(field, raw);
    if (!field.group) {
      result[field.key] = value;
    } else {
      let group = result[field.group];
      if (!isRecord(group)) {
        group = {};
        result[field.group] = group;
      }
      if (isRecord(group)) group[field.key] = value;
    }
  }
  return result;
}

export function NativeSettingsSection() {
  const ko = useLocale() === "ko";
  const threadId = useAppSelector(state => state.activeThreadId);
  const read = useCallback((scope: NativeSettingsScope) => window.omo.readNativeSettings(scope, threadId), [threadId]);
  const save = useCallback((input: NativeSettingsInput) => window.omo.saveNativeSettings(input, threadId), [threadId]);
  const [scope, setScope] = useState<NativeSettingsScope>("global");
  const [snapshot, setSnapshot] = useState<NativeSettingsSnapshot | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);

  const reloadSettings = useCallback(() => setReload((value) => value + 1), []);
  useEffect(() => {
    let live = true;
    generation.current++;
    setSnapshot(null); setDrafts({}); setError(false); setSaved(false); setBusy(false);
    void read(scope).then(
      (next) => { if (live) setSnapshot(next); },
      () => { if (live) setError(true); },
    );
    return () => { live = false; };
  }, [scope, read, reload]);

  const submit = async (): Promise<void> => {
    if (!snapshot) return;
    setBusy(true); setError(false); setSaved(false);
    const requestGeneration = generation.current;
    try {
      const next = await save({ scope, revision: snapshot.revision, values: patch(drafts) });
      if (requestGeneration !== generation.current) return;
      setSnapshot(next); setDrafts({}); setSaved(true);
    } catch { if (requestGeneration === generation.current) setError(true); }
    finally { if (requestGeneration === generation.current) setBusy(false); }
  };

  return <SettingsCard testId="native-settings">
    <div className={ui.cardBody}>
      <h3 className={ui.heading}>{ko ? "네이티브 설정" : "Native settings"}</h3>
      <p className={ui.muted}>{ko
        ? "변경 사항을 적용하려면 네이티브 세션을 재시작해야 할 수 있습니다. 실행 중인 세션은 자동으로 재시작하지 않습니다. 프로젝트 설정 저장은 신뢰를 부여하지 않습니다."
        : "A native session restart may be required. Running sessions are not restarted automatically. Saving project settings does not grant trust."}</p>
      <label className={ui.text}>{ko ? "범위" : "Scope"}{" "}
        <select className={ui.control} value={scope} disabled={busy} onChange={(event) => {
          setScope(event.target.value === "project" ? "project" : "global");
        }}>
          <option value="global">{ko ? "전역" : "Global"}</option>
          <option value="project" disabled={threadId === null}>{ko ? "프로젝트" : "Project"}</option>
        </select>
      </label>
      {snapshot && <p className={ui.muted}><code className={ui.mono}>{snapshot.configPath}</code></p>}
      <p className={ui.muted}>{ko
        ? "변경한 항목만 저장합니다. 빈 모델 목록은 허용됩니다. 모델별 행을 지워도 기존 설정은 삭제되지 않습니다."
        : "Only edited fields are saved. Empty model lists are allowed. Removing an override row does not delete existing settings."}</p>
      <p className={ui.muted}>{ko
        ? "네이티브 5.1.54의 RPC 모델 목록은 활성 모델 제한을 반영하지 않습니다. 이 값의 저장을 앱 모델 목록의 필터 적용으로 간주하지 마세요."
        : "The native 5.1.54 RPC model catalog does not apply enabled-model narrowing. Saving this value does not filter the app model picker."}</p>
    </div>
    {fields.map((field) => {
      const label = ko ? field.ko : field.en;
      const id = fieldId(field);
      const value = drafts[id] ?? display(snapshot ? get(snapshot.values, field) : undefined, field.kind);
      const change = (next: string): void => {
        setDrafts((old) => ({ ...old, [id]: next }));
        setSaved(false);
      };
      const hint = field.kind === "list" ? (ko ? "한 줄에 모델 하나" : "One model per line")
        : field.kind === "overrides" ? (ko ? "한 줄에 provider/model | 예약 토큰 | 최근 토큰" : "One per line: provider/model | reserve tokens | recent tokens")
        : field.key === "speculativeLeadTokens" ? "8192–32768" : undefined;
      return <SettingRow key={id} title={label} hint={hint}>
        {field.kind === "boolean" || field.kind === "choice"
          ? <select className={ui.control} aria-label={label} disabled={!snapshot || busy} value={value} onChange={(event) => change(event.target.value)}>
              <option value="">{ko ? "설정되지 않음" : "Not set"}</option>
              {(field.kind === "boolean" ? ["true", "false"] : field.choices ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          : field.kind === "list" || field.kind === "overrides"
            ? <textarea className={`${ui.field} w-75 max-w-full p-2 text-sm`} rows={3} aria-label={label} disabled={!snapshot || busy} value={value} onChange={(event) => change(event.target.value)} />
            : <input className={ui.control} aria-label={label} inputMode={field.kind === "number" ? "numeric" : undefined} disabled={!snapshot || busy} value={value} onChange={(event) => change(event.target.value)} />}
      </SettingRow>;
    })}
    <div className={ui.cardBody}>
      <Button variant="primary" disabled={!snapshot || busy || Object.keys(drafts).length === 0} onClick={() => void submit()}>
        {busy ? (ko ? "저장 중" : "Saving") : (ko ? "저장" : "Save")}
      </Button>
      <Button variant="outline" disabled={busy} onClick={reloadSettings}>
        {ko ? "다시 불러오기" : "Reload"}
      </Button>
      {saved && <p role="status" className={ui.muted}>{ko ? "저장했습니다." : "Saved."}</p>}
      {error && <ErrorText>{ko ? "읽기 또는 저장에 실패했습니다. 값을 확인하거나 다시 불러오세요." : "Read or save failed. Check the values or reload."}</ErrorText>}
    </div>
  </SettingsCard>;
}
