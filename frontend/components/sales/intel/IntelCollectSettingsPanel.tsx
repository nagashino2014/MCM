"use client";

// 수집 설정 패널(C-3) — B단계 API(/api/sales/intel/settings) 사용.
// 공통(소스 ON/OFF·공시일 하한) / 소스별 옵션 탭 / 수동 실행 3단 구성.
// 스로틀·타임아웃 등 저수준 값은 노출하지 않는다(소스 차단 위험).

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Play, RefreshCw, RotateCcw, Save, X } from "lucide-react";
import type { IntelCollectSettings, IntelIndustryItem } from "@/lib/intel/intel-settings";
import { INTEGRATED_PERMIT_INDUSTRIES } from "@/lib/ieps/integrated-permit-industries";

// press-client.ts 의 PRESS_SOURCE_LABELS 와 동일 — 해당 모듈은 undici(node 전용) 의존이라
// 클라이언트 번들에서 import 할 수 없어 라벨만 복제한다.
const PRESS_SOURCE_LABELS: Record<string, string> = {
  ulsan: "울산광역시",
  jeonnam: "전라남도",
  gyeongbuk: "경상북도",
  chungnam: "충청남도",
  gyeonggi: "경기도",
  gyeongnam: "경상남도",
  jeonbuk: "전북특별자치도",
  mcee: "기후에너지환경부",
};

export interface CollectStateRow {
  source: string;
  lastRunAt: string | null;
  lastCursor: string | null;
}

const SETTING_TABS = [
  { key: "common", label: "공통" },
  { key: "dart", label: "DART" },
  { key: "eiass", label: "EIASS" },
  { key: "news", label: "NAVER" },
  { key: "press", label: "보도자료" },
  { key: "gosi", label: "토지이음·유역청" },
  { key: "run", label: "수동 실행" },
] as const;
type SettingTab = (typeof SETTING_TABS)[number]["key"];

const RUN_SOURCES = [
  { key: "dart", label: "DART" },
  { key: "eiass", label: "EIASS" },
  { key: "press", label: "보도자료" },
  { key: "news", label: "NAVER 뉴스" },
  { key: "gosi", label: "고시(토지이음·유역청)" },
] as const;

const COLLECT_STATE_LABEL: Record<string, string> = {
  dart: "DART", eiass: "EIASS", press: "보도자료", news: "NAVER", gosi: "고시",
};

function fmtRunAt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** 키워드 칩 편집기 — Enter/추가 버튼으로 삽입, X로 삭제. */
function KeywordChips({
  value,
  onChange,
  disabled,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const kw = draft.trim();
    if (!kw || value.includes(kw)) { setDraft(""); return; }
    onChange([...value, kw]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1 flex-wrap">
        {value.map((kw) => (
          <span key={kw} className="cd-chip cd-chip-sm">
            {kw}
            {!disabled && (
              <button type="button" onClick={() => onChange(value.filter((v) => v !== kw))} title="삭제">
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
        {value.length === 0 && <span className="cd-text-faint text-xs">키워드 없음</span>}
      </div>
      {!disabled && (
        <div className="flex items-center gap-1.5">
          <input
            className="cd-input"
            style={{ maxWidth: 220 }}
            value={draft}
            placeholder={placeholder ?? "키워드 입력 후 Enter"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          />
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={add}>추가</button>
        </div>
      )}
    </div>
  );
}

/** 통합허가 대상 업종 편집기 — 업종 태깅(관련성 판단) 후보군. 신규 편입 업종 추가/제외 대응. */
function IndustryChips({
  value,
  onChange,
  disabled,
}: {
  value: IntelIndustryItem[];
  onChange: (next: IntelIndustryItem[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const defaults: IntelIndustryItem[] = INTEGRATED_PERMIT_INDUSTRIES.map((i) => ({ id: i.id, label: i.label }));
  const add = () => {
    const label = draft.trim();
    if (!label || value.some((v) => v.label === label)) { setDraft(""); return; }
    // 기본 20종과 같은 라벨이면 원래 id 를 복원(KSIC 매핑·규칙 층 연동 유지), 신규는 라벨 자체가 id
    const known = defaults.find((d) => d.label === label);
    onChange([...value, known ?? { id: label, label }]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1 flex-wrap">
        {value.map((it) => (
          <span key={it.id} className="cd-chip cd-chip-sm" title={it.note ?? it.id}>
            {it.label}
            {!disabled && (
              <button type="button" onClick={() => onChange(value.filter((v) => v.id !== it.id))} title="삭제">
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
        {value.length === 0 && <span className="cd-text-faint text-xs">업종 없음 — 태깅이 동작하지 않습니다</span>}
      </div>
      {!disabled && (
        <div className="flex items-center gap-1.5">
          <input
            className="cd-input"
            style={{ maxWidth: 220 }}
            value={draft}
            placeholder="업종명 입력 후 Enter"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          />
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={add}>추가</button>
          <button
            type="button" className="cd-btn cd-btn-ghost cd-btn-sm" title="기본 20종으로 복원"
            onClick={() => onChange(defaults)}
          >
            기본값 복원
          </button>
        </div>
      )}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <label className={`inline-flex items-center gap-2 text-[13px] font-bold ${disabled ? "opacity-60" : "cursor-pointer"}`} style={{ color: "var(--cd-text)" }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative inline-flex shrink-0 rounded-full transition-colors"
        style={{
          width: 36, height: 20,
          background: checked ? "var(--cd-primary)" : "var(--cd-border)",
        }}
      >
        <span
          className="absolute top-0.5 rounded-full bg-white transition-all"
          style={{ width: 16, height: 16, left: checked ? 18 : 2 }}
        />
      </button>
      {label}
    </label>
  );
}

function FieldRow({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="shrink-0 pt-1" style={{ width: 150 }}>
        <span className="text-[12px] font-bold" style={{ color: "var(--cd-muted)" }}>{label}</span>
        {hint && <p className="text-[10px] mt-0.5 leading-snug" style={{ color: "var(--cd-faint)" }}>{hint}</p>}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

export function IntelCollectSettingsPanel({
  canEdit,
  collectState,
  onCollected,
}: {
  canEdit: boolean;
  collectState: CollectStateRow[];
  /** 수동 수집 완료 후 리스트·통계 갱신 */
  onCollected: () => void;
}) {
  const [tab, setTab] = useState<SettingTab>("common");
  const [settings, setSettings] = useState<IntelCollectSettings | null>(null);
  const [saved, setSaved] = useState<string | null>(null); // 직렬화 스냅샷(dirty 판정)
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [runSource, setRunSource] = useState<(typeof RUN_SOURCES)[number]["key"]>("dart");
  const [runDays, setRunDays] = useState(7);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sales/intel/settings", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      const data = await res.json();
      setSettings(data.settings);
      setSaved(JSON.stringify(data.settings));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => settings != null && JSON.stringify(settings) !== saved, [settings, saved]);

  const save = async () => {
    if (!settings) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/sales/intel/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setSettings(data.settings);
      setSaved(JSON.stringify(data.settings));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // 수동 실행 — 소량 테스트 수집(전량은 야간 배치)
  const run = async () => {
    setRunning(true); setRunMsg(null);
    try {
      const body =
        runSource === "dart"
          ? { days: runDays, maxPages: 2, maxDocs: 5 }
          : runSource === "eiass"
            ? { source: "eiass", maxPages: 2 }
            : { source: runSource };
      const res = await fetch("/api/sales/intel/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      const g = data.byGrade ?? {};
      setRunMsg(
        `스캔 ${data.scanned ?? 0} / 저장 ${data.inserted ?? 0}` +
          ` (확정 ${g.confirmed ?? 0}·후보 ${g.candidate ?? 0}·관찰 ${g.monitoring ?? 0}·제외 ${g.excluded ?? 0})` +
          (data.matched != null ? ` · 매칭 ${data.matched}` : "")
      );
      onCollected();
    } catch (e) {
      setRunMsg(`수집 실패: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  const set = <K extends keyof IntelCollectSettings>(key: K, patch: Partial<IntelCollectSettings[K]>) =>
    setSettings((prev) => (prev ? { ...prev, [key]: { ...prev[key], ...patch } } : prev));

  return (
    <section className="cd-card-bg rounded-2xl border cd-border-c p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h2 className="cd-card-title cd-text text-[15px] font-extrabold">수집 설정</h2>
        {canEdit && (
          <div className="flex items-center gap-2">
            {dirty && (
              <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={load} disabled={saving}>
                <RotateCcw className="w-3.5 h-3.5" /> 되돌리기
              </button>
            )}
            <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={save} disabled={!dirty || saving}>
              <Save className="w-3.5 h-3.5" /> {saving ? "저장 중…" : "설정 저장"}
            </button>
          </div>
        )}
      </div>

      {error && <div className="cd-error-bg cd-error-text rounded-lg px-3 py-2 text-xs mb-3">{error}</div>}

      <div className="flex items-center gap-1 flex-wrap mb-3">
        {SETTING_TABS.map((t) => (
          <button key={t.key} className="cd-chip cd-chip-sm" data-active={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {!settings ? (
        <div className="cd-text-faint text-sm py-4">설정을 불러오는 중…</div>
      ) : (
        <div className="rounded-xl border cd-border-c px-3 py-1.5">
          {tab === "common" && (
            <>
              <FieldRow label="소스 사용" hint="끄면 야간 배치·수동 실행 모두 건너뜁니다.">
                <div className="flex items-center gap-4 flex-wrap py-1">
                  <Toggle label="DART" checked={settings.dart.enabled} disabled={!canEdit} onChange={(v) => set("dart", { enabled: v })} />
                  <Toggle label="EIASS" checked={settings.eiass.enabled} disabled={!canEdit} onChange={(v) => set("eiass", { enabled: v })} />
                  <Toggle label="NAVER" checked={settings.news.enabled} disabled={!canEdit} onChange={(v) => set("news", { enabled: v })} />
                  <Toggle label="보도자료" checked={settings.press.enabled} disabled={!canEdit} onChange={(v) => set("press", { enabled: v })} />
                  <Toggle label="고시" checked={settings.gosi.enabled} disabled={!canEdit} onChange={(v) => set("gosi", { enabled: v })} />
                </div>
              </FieldRow>
              <FieldRow label="공시일 수집 하한(개월)" hint="이보다 오래된 공시·접수일 건은 저장하지 않습니다. 0 = 제한 없음">
                <input
                  type="number" min={0} max={120} className="cd-input" style={{ width: 90 }}
                  value={settings.common.maxAgeMonths} disabled={!canEdit}
                  onChange={(e) => set("common", { maxAgeMonths: Math.max(0, Number(e.target.value) || 0) })}
                />
              </FieldRow>
              <FieldRow label="통합허가 대상 업종" hint="업종 태깅(관련성 판단)의 후보군 — 신규 편입 업종은 여기에 추가하세요">
                <IndustryChips
                  value={settings.industries?.list ?? []}
                  disabled={!canEdit}
                  onChange={(list) => set("industries", { list })}
                />
              </FieldRow>
            </>
          )}

          {tab === "dart" && (
            <>
              <FieldRow label="소급 일수" hint="야간 배치가 조회하는 과거 일수(전일 증분=1)">
                <input
                  type="number" min={1} max={30} className="cd-input" style={{ width: 90 }}
                  value={settings.dart.days} disabled={!canEdit}
                  onChange={(e) => set("dart", { days: Math.max(1, Number(e.target.value) || 1) })}
                />
              </FieldRow>
              <FieldRow label="2차 원문 분석" hint="공급·수주 계약 원문에서 발주처(거래상대방)를 대조해 counterparty 매칭">
                <Toggle label={settings.dart.counterpartyScan ? "사용" : "사용 안 함"} checked={settings.dart.counterpartyScan} disabled={!canEdit} onChange={(v) => set("dart", { counterpartyScan: v })} />
              </FieldRow>
              <FieldRow label="공급계약 발주처 리드" hint="매칭 실패한 공급계약 원문을 AI가 분석해, 통합허가 대상급 시설(공장·발전소·소각 등) 공사의 발주처를 미매칭 리드로 수집">
                <Toggle label={settings.dart.supplyLeadScan ? "사용" : "사용 안 함"} checked={settings.dart.supplyLeadScan} disabled={!canEdit} onChange={(v) => set("dart", { supplyLeadScan: v })} />
              </FieldRow>
              <FieldRow label="리드 분석 일일 상한" hint="공급계약 리드 AI 분류 건수 상한(비용 가드)">
                <input
                  type="number" min={0} max={200} className="cd-input" style={{ width: 90 }}
                  value={settings.dart.supplyLeadMaxClassify} disabled={!canEdit}
                  onChange={(e) => set("dart", { supplyLeadMaxClassify: Math.max(0, Number(e.target.value) || 0) })}
                />
              </FieldRow>
            </>
          )}

          {tab === "eiass" && (
            <>
              <FieldRow label="스캔 페이지 수" hint="평가종류별 리스트 페이지 수(10행/페이지)">
                <input
                  type="number" min={1} max={50} className="cd-input" style={{ width: 90 }}
                  value={settings.eiass.maxPages} disabled={!canEdit}
                  onChange={(e) => set("eiass", { maxPages: Math.max(1, Number(e.target.value) || 1) })}
                />
              </FieldRow>
              <FieldRow label="포함 키워드" hint="사업명에 하나라도 있으면 수집 후보">
                <KeywordChips value={settings.eiass.positiveKeywords} disabled={!canEdit} onChange={(v) => set("eiass", { positiveKeywords: v })} />
              </FieldRow>
              <FieldRow label="제외 키워드" hint="사업명에 있으면 제외(태양광 등 오탐)">
                <KeywordChips value={settings.eiass.negativeKeywords} disabled={!canEdit} onChange={(v) => set("eiass", { negativeKeywords: v })} />
              </FieldRow>
            </>
          )}

          {tab === "news" && (
            <>
              <FieldRow label="검색 키워드">
                <KeywordChips value={settings.news.keywords} disabled={!canEdit} onChange={(v) => set("news", { keywords: v })} />
              </FieldRow>
              <FieldRow label="키워드당 건수" hint="1~200 (100 초과는 API 페이지 분할 호출)">
                <input
                  type="number" min={1} max={200} className="cd-input" style={{ width: 90 }}
                  value={settings.news.displayPerKeyword} disabled={!canEdit}
                  onChange={(e) => set("news", { displayPerKeyword: Math.min(200, Math.max(1, Number(e.target.value) || 1)) })}
                />
              </FieldRow>
              <FieldRow label="일일 AI 분류 상한" hint="Haiku 분류 비용 통제. 0 = 무제한">
                <input
                  type="number" min={0} className="cd-input" style={{ width: 90 }}
                  value={settings.news.maxClassify} disabled={!canEdit}
                  onChange={(e) => set("news", { maxClassify: Math.max(0, Number(e.target.value) || 0) })}
                />
              </FieldRow>
            </>
          )}

          {tab === "press" && (
            <>
              <FieldRow label="지자체 어댑터" hint="발표 주체별 수집 ON/OFF">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 py-1 sm:grid-cols-3">
                  {Object.keys(PRESS_SOURCE_LABELS).map((key) => (
                    <Toggle
                      key={key}
                      label={PRESS_SOURCE_LABELS[key]}
                      checked={settings.press.adapters[key] !== false}
                      disabled={!canEdit}
                      onChange={(v) => set("press", { adapters: { ...settings.press.adapters, [key]: v } })}
                    />
                  ))}
                </div>
              </FieldRow>
              <FieldRow label="제목 키워드">
                <KeywordChips value={settings.press.titleKeywords} disabled={!canEdit} onChange={(v) => set("press", { titleKeywords: v })} />
              </FieldRow>
              <FieldRow label="부서 키워드">
                <KeywordChips value={settings.press.deptKeywords} disabled={!canEdit} onChange={(v) => set("press", { deptKeywords: v })} />
              </FieldRow>
            </>
          )}

          {tab === "gosi" && (
            <>
              <div className="flex items-center gap-2 py-2">
                <span className="cd-pill cd-pill-warn inline-flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> 토지이음: AWS IP 차단 — 로컬 수집 필요
                </span>
                <span className="text-[11px]" style={{ color: "var(--cd-faint)" }}>
                  eum.go.kr 이 AWS 대역을 차단해 야간 배치에서 토지이음 채널만 실패합니다(유역청 RSS 는 정상).
                </span>
              </div>
              <FieldRow label="토지이음 검색 키워드">
                <div className="flex items-center gap-4 py-1">
                  {["산업단지", "농공단지"].map((kw) => (
                    <Toggle
                      key={kw}
                      label={kw}
                      checked={settings.gosi.eumKeywords.includes(kw)}
                      disabled={!canEdit}
                      onChange={(v) =>
                        set("gosi", {
                          eumKeywords: v
                            ? [...settings.gosi.eumKeywords, kw]
                            : settings.gosi.eumKeywords.filter((k) => k !== kw),
                        })
                      }
                    />
                  ))}
                </div>
              </FieldRow>
              <FieldRow label="키워드당 페이지 수">
                <input
                  type="number" min={1} max={10} className="cd-input" style={{ width: 90 }}
                  value={settings.gosi.maxPagesPerKeyword} disabled={!canEdit}
                  onChange={(e) => set("gosi", { maxPagesPerKeyword: Math.max(1, Number(e.target.value) || 1) })}
                />
              </FieldRow>
              <FieldRow label="유역청 RSS" hint="유역·지방환경청 고시 RSS 수집">
                <Toggle label={settings.gosi.rssEnabled ? "사용" : "사용 안 함"} checked={settings.gosi.rssEnabled} disabled={!canEdit} onChange={(v) => set("gosi", { rssEnabled: v })} />
              </FieldRow>
            </>
          )}

          {tab === "run" && (
            <div className="py-2 flex flex-col gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <select className="cd-select" style={{ width: "auto" }} value={runSource} onChange={(e) => setRunSource(e.target.value as typeof runSource)} disabled={!canEdit}>
                  {RUN_SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                {runSource === "dart" && (
                  <select className="cd-select" style={{ width: "auto" }} value={runDays} onChange={(e) => setRunDays(Number(e.target.value))} disabled={!canEdit}>
                    <option value={1}>1일</option>
                    <option value={3}>3일</option>
                    <option value={7}>1주</option>
                    <option value={14}>2주</option>
                  </select>
                )}
                <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={run} disabled={!canEdit || running} title="정상작동 확인용 소량 테스트 수집(전량은 야간 배치)">
                  {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  {running ? "수집 중…" : "지금 수집(소량 테스트)"}
                </button>
              </div>
              {runMsg && <div className="cd-tint-primary rounded-lg px-3 py-2 text-xs cd-text">{runMsg}</div>}
              <div>
                <p className="text-[11px] font-bold mb-1" style={{ color: "var(--cd-muted)" }}>소스별 마지막 수집</p>
                <div className="flex items-center gap-3 flex-wrap">
                  {collectState.length === 0 ? (
                    <span className="cd-text-faint text-xs">수집 이력이 없습니다.</span>
                  ) : (
                    collectState.map((st) => (
                      <span key={st.source} className="text-[11px] tabular-nums" style={{ color: "var(--cd-muted)" }}>
                        <b style={{ color: "var(--cd-text)" }}>{COLLECT_STATE_LABEL[st.source] ?? st.source}</b>{" "}
                        {fmtRunAt(st.lastRunAt)}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
