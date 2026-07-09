"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Radar, Search, X, RefreshCw, ExternalLink, Building2, Plus, Ban } from "lucide-react";
import { useSession } from "next-auth/react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdThemeToggle } from "@/components/cdash/CdThemeToggle";
import "@/components/cdash/cdash.css";
import { INTEL_SIGNAL_TYPE_LABELS, INTEL_SIGNAL_GRADE_LABELS } from "@/lib/intel/signal-extractor";

// API 응답 shape(서버 intel-queries IntelSignal과 동일).
interface IntelSignal {
  signalId: string;
  source: string;
  corpCode: string | null;
  companyName: string | null;
  brn: string | null;
  reportName: string | null;
  signalType: string;
  signalGrade: string;
  assetClass: string | null;
  acquirePurpose: string | null;
  counterparty: string | null;
  disclosedAt: string | null;
  amount: number | null;
  url: string | null;
  facilityId: string | null;
  facilityName: string | null;
  matchStatus: string;
  matchType: string;
  linkedProjectId: string | null;
  status: string;
  createdAt: string;
}

interface FacilityOption {
  facilityId: string;
  companyName: string;
}

const TYPE_PILL: Record<string, string> = {
  investment: "cd-pill-info",
  expansion: "cd-pill-warn",
  new_site: "cd-pill-success",
  other: "cd-pill-idle",
};
const STATUS_LABEL: Record<string, string> = { new: "신규", reviewed: "검토", converted: "전환", dismissed: "무시" };
const STATUS_PILL: Record<string, string> = {
  new: "cd-pill-info",
  reviewed: "cd-pill-idle",
  converted: "cd-pill-success",
  dismissed: "cd-pill-outline",
};
const GRADE_PILL: Record<string, string> = {
  confirmed: "cd-pill-success",
  candidate: "cd-pill-info",
  monitoring: "cd-pill-warn",
  excluded: "cd-pill-outline",
};
// 소스 라벨(목록 원문 링크·필터 공용)
const SOURCE_LABEL: Record<string, string> = { dart: "DART", news: "뉴스", eiass: "EIASS", press: "보도자료", gosi: "고시" };

function TypeTag({ type }: { type: string }) {
  return <span className={`cd-pill ${TYPE_PILL[type] ?? "cd-pill-idle"}`}>{INTEL_SIGNAL_TYPE_LABELS[type as keyof typeof INTEL_SIGNAL_TYPE_LABELS] ?? type}</span>;
}
function GradeTag({ grade }: { grade: string }) {
  return <span className={`cd-pill ${GRADE_PILL[grade] ?? "cd-pill-idle"}`}>{INTEL_SIGNAL_GRADE_LABELS[grade as keyof typeof INTEL_SIGNAL_GRADE_LABELS] ?? grade}</span>;
}
// 2차 매칭(공시자≠대상, 발주처=대상)임을 표시. direct는 배지 없음.
function MatchTypeTag({ type }: { type: string }) {
  if (type !== "counterparty") return null;
  return <span className="cd-pill cd-pill-outline" title="공시자가 아닌 거래상대방(발주처)이 통합허가 대상">거래상대</span>;
}

export function IntelBoard() {
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as { role?: "admin" | "editor" | "viewer" } | undefined)?.role ?? "viewer";
  const canEdit = role === "admin" || role === "editor";
  const { theme, toggleTheme } = useCdashTheme();

  const [signals, setSignals] = useState<IntelSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [collectMsg, setCollectMsg] = useState<string | null>(null);
  const [testDays, setTestDays] = useState(7); // 수집 테스트 기간 프리셋
  const [testSource, setTestSource] = useState<"dart" | "eiass" | "press" | "gosi">("dart"); // 수집 테스트 대상 소스
  const [selected, setSelected] = useState<IntelSignal | null>(null);

  const [q, setQ] = useState("");
  const [signalType, setSignalType] = useState("");
  const [matchStatus, setMatchStatus] = useState("");
  const [status, setStatus] = useState("");
  const [grade, setGrade] = useState(""); // 서버 필터. ''=확정+후보 기본, 'all'=전체, 특정등급
  const [sourceFilter, setSourceFilter] = useState(""); // dart | news | eiass

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = grade ? `/api/sales/intel/signals?grade=${grade}` : "/api/sales/intel/signals";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      const data = await res.json();
      setSignals(Array.isArray(data.signals) ? data.signals : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [grade]);

  useEffect(() => {
    reload();
  }, [reload]);

  const collect = async () => {
    setCollecting(true);
    setCollectMsg(null);
    try {
      const body =
        testSource === "eiass"
          ? { source: "eiass", maxPages: 2 }
          : testSource === "press" || testSource === "gosi"
            ? { source: testSource }
            : { days: testDays, maxPages: 2, maxDocs: 5 };
      const res = await fetch("/api/sales/intel/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      const g = data.byGrade ?? {};
      const gradeMsg = `(확정 ${g.confirmed ?? 0}·후보 ${g.candidate ?? 0}·관찰 ${g.monitoring ?? 0}·제외 ${g.excluded ?? 0})`;
      setCollectMsg(
        testSource === "eiass"
          ? `EIASS 테스트 · 스캔 ${data.scanned} / 신규 ${data.newFound ?? 0}·키워드 ${data.kwPassed ?? 0} / 상세 ${data.detailFetched ?? 0} ` +
            `/ 신호 ${data.signals ?? 0} / 저장 ${data.inserted} (매칭 ${data.matched ?? 0}·리드 ${data.newLead ?? 0}) ${gradeMsg}`
          : testSource === "press"
            ? `보도자료 테스트 · 스캔 ${data.scanned} / 신규 ${data.newFound ?? 0}·키워드 ${data.kwPassed ?? 0} / 분류 ${data.classified ?? 0} ` +
              `/ 신호 ${data.signals ?? 0} / 저장 ${data.inserted} (매칭 ${data.matched ?? 0}·리드 ${data.newLead ?? 0}) ${gradeMsg}`
            : testSource === "gosi"
              ? `고시 테스트 · 스캔 ${data.scanned} / 신규 ${data.newFound ?? 0}·키워드 ${data.kwPassed ?? 0} / 저장 ${data.inserted} ${gradeMsg}`
              : `테스트 수집 · 조회 ${data.scanned}${data.truncated ? "(일부)" : ""} / 회사조회 ${data.corpQueried ?? 0} / 매칭후보 ${data.matched ?? 0} ` +
                `/ 원문 ${data.docScanned ?? 0}·거래상대 ${data.counterpartyMatched ?? 0} / 신규 ${data.inserted} ${gradeMsg}`
      );
      await reload();
    } catch (e) {
      setCollectMsg(`수집 테스트 실패: ${(e as Error).message}`);
    } finally {
      setCollecting(false);
    }
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return signals.filter((sig) => {
      if (sourceFilter && sig.source !== sourceFilter) return false;
      if (signalType && sig.signalType !== signalType) return false;
      if (matchStatus && sig.matchStatus !== matchStatus) return false;
      if (status && sig.status !== status) return false;
      if (s) {
        const hay = [sig.companyName, sig.reportName].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [signals, q, sourceFilter, signalType, matchStatus, status]);

  const hasFilter = !!(q || sourceFilter || signalType || matchStatus || status || grade);

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<Radar className="w-5 h-5" />}
        eyebrow="SALES & MARKETING"
        title="API & RAG"
        titleSuffix={`${filtered.length}건${hasFilter ? ` / ${signals.length}` : ""}`}
        subtitle="공시·뉴스·환경영향평가 협의에서 통합허가 대상 사업장의 투자·증설·신설 신호를 수집해 고지합니다."
        actions={
          <>
            {canEdit && (
              <>
                <select
                  className="cd-select cd-btn-sm"
                  style={{ width: "auto" }}
                  value={testSource}
                  onChange={(e) => setTestSource(e.target.value as "dart" | "eiass" | "press" | "gosi")}
                  title="수집 테스트 대상 소스"
                >
                  <option value="dart">DART</option>
                  <option value="eiass">EIASS</option>
                  <option value="press">보도자료</option>
                  <option value="gosi">고시</option>
                </select>
                {testSource === "dart" && (
                  <select
                    className="cd-select cd-btn-sm"
                    style={{ width: "auto" }}
                    value={testDays}
                    onChange={(e) => setTestDays(Number(e.target.value))}
                    title="수집 테스트 기간"
                  >
                    <option value={1}>1일</option>
                    <option value={3}>3일</option>
                    <option value={7}>1주</option>
                    <option value={14}>2주</option>
                  </select>
                )}
                <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={collect} disabled={collecting} title="정상작동 확인용 소량 테스트 수집(전량은 야간 배치)">
                  <RefreshCw className={`w-4 h-4 ${collecting ? "animate-spin" : ""}`} /> {collecting ? "테스트 중…" : "수집 테스트"}
                </button>
              </>
            )}
            <CdThemeToggle theme={theme} onToggle={toggleTheme} />
          </>
        }
      />

      {collectMsg && <div className="cd-tint-primary rounded-xl px-4 py-2.5 text-sm mb-3 cd-text">{collectMsg}</div>}

      {/* 툴바 */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="flex items-center gap-1.5">
          <Search className="w-4 h-4 cd-text-faint" />
          <input className="cd-input" style={{ width: 220 }} placeholder="회사명·공시명 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="cd-select" style={{ width: "auto" }} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="">소스 전체</option>
          <option value="dart">DART</option>
          <option value="news">뉴스</option>
          <option value="eiass">EIASS</option>
          <option value="press">보도자료</option>
          <option value="gosi">고시</option>
        </select>
        <select className="cd-select" style={{ width: "auto" }} value={signalType} onChange={(e) => setSignalType(e.target.value)}>
          <option value="">신호유형 전체</option>
          <option value="investment">투자</option>
          <option value="expansion">증설</option>
          <option value="new_site">신설</option>
          <option value="other">기타</option>
        </select>
        <select className="cd-select" style={{ width: "auto" }} value={matchStatus} onChange={(e) => setMatchStatus(e.target.value)}>
          <option value="">매칭 전체</option>
          <option value="matched">매칭</option>
          <option value="unmatched">미매칭</option>
        </select>
        <select className="cd-select" style={{ width: "auto" }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">상태 전체</option>
          <option value="new">신규</option>
          <option value="reviewed">검토</option>
          <option value="converted">전환</option>
          <option value="dismissed">무시</option>
        </select>
        <select className="cd-select" style={{ width: "auto" }} value={grade} onChange={(e) => setGrade(e.target.value)}>
          <option value="">기본(확정·후보)</option>
          <option value="all">등급 전체</option>
          <option value="confirmed">확정</option>
          <option value="candidate">후보</option>
          <option value="monitoring">관찰</option>
          <option value="excluded">제외</option>
        </select>
        {hasFilter && (
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => { setQ(""); setSourceFilter(""); setSignalType(""); setMatchStatus(""); setStatus(""); setGrade(""); }}>
            <X className="w-3.5 h-3.5" /> 초기화
          </button>
        )}
      </div>

      {error && <div className="cd-error-bg cd-error-text rounded-xl px-4 py-3 text-sm mb-3">{error}</div>}

      {loading ? (
        <div className="cd-text-faint text-sm p-6">불러오는 중…</div>
      ) : filtered.length === 0 ? (
        <div className="cd-text-faint text-sm p-6 text-center cd-card-bg rounded-2xl border cd-border-c">
          수집된 신호가 없습니다. {canEdit ? "‘지금 수집’으로 DART 공시를 가져오세요." : ""}
        </div>
      ) : (
        <div className="cd-card-bg rounded-2xl border cd-border-c overflow-hidden">
          <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 240px)" }}>
            <table className="cd-table">
              <thead>
                <tr>
                  <th>회사명</th>
                  <th>신호유형</th>
                  <th>등급</th>
                  <th>공시명</th>
                  <th>공시일</th>
                  <th>매칭 사업장</th>
                  <th>상태</th>
                  <th>원문</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((sig) => (
                  <tr key={sig.signalId} className="cursor-pointer" onClick={() => setSelected(sig)}>
                    <td className="cd-text font-bold">
                      {sig.companyName ?? "—"} <MatchTypeTag type={sig.matchType} />
                    </td>
                    <td><TypeTag type={sig.signalType} /></td>
                    <td><GradeTag grade={sig.signalGrade} /></td>
                    <td className="cd-text-muted">{sig.reportName ?? "—"}</td>
                    <td className="cd-text-muted tabular-nums">{sig.disclosedAt ?? "—"}</td>
                    <td className={sig.facilityName ? "cd-text" : "cd-text-faint"}>{sig.facilityName ?? "미매칭"}</td>
                    <td><span className={`cd-pill ${STATUS_PILL[sig.status] ?? "cd-pill-idle"}`}>{STATUS_LABEL[sig.status] ?? sig.status}</span></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {sig.url ? (
                        <a href={sig.url} target="_blank" rel="noreferrer" className="cd-text-primary inline-flex items-center gap-1 text-xs">
                          <ExternalLink className="w-3.5 h-3.5" /> {SOURCE_LABEL[sig.source] ?? sig.source}
                        </a>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <IntelDetailModal
          theme={theme}
          signal={selected}
          canEdit={canEdit}
          onClose={() => setSelected(null)}
          onChanged={() => { reload(); }}
          onConverted={(projectId) => router.push(`/sales/${projectId}`)}
        />
      )}
    </div>
  );
}

function IntelDetailModal({
  theme,
  signal,
  canEdit,
  onClose,
  onChanged,
  onConverted,
}: {
  theme: string;
  signal: IntelSignal;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
  onConverted: (projectId: string) => void;
}) {
  const s = signal;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [facilityQuery, setFacilityQuery] = useState("");
  const [facilityResults, setFacilityResults] = useState<FacilityOption[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!facilityQuery.trim()) { setFacilityResults([]); return; }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/facilities?q=${encodeURIComponent(facilityQuery)}&limit=8`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        const items = (data.items ?? data.facilities ?? []) as Array<Record<string, unknown>>;
        setFacilityResults(
          items.map((it) => ({
            facilityId: String(it.facilityId ?? it.facility_id ?? ""),
            companyName: String(it.companyName ?? it.company_name ?? ""),
          })).filter((it) => it.facilityId)
        );
      } catch {
        setFacilityResults([]);
      }
    }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [facilityQuery]);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/sales/intel/signals/${s.signalId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      onChanged();
      onClose();
    } catch (e) {
      setErr((e as Error).message); setBusy(false);
    }
  };

  const convert = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/sales/intel/signals/${s.signalId}/convert`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onConverted(String(data.projectId));
    } catch (e) {
      setErr((e as Error).message); setBusy(false);
    }
  };

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-start gap-2 py-1.5">
      <span className="cd-text-faint text-xs shrink-0" style={{ width: 72 }}>{label}</span>
      <span className="cd-text text-sm flex-1 min-w-0 break-words">{value}</span>
    </div>
  );

  return (
    <div className="cd-modal-overlay cdash cd-fields-white" data-theme={theme} onClick={onClose}>
      <div className="cd-modal cd-card-bg w-full" style={{ maxWidth: 480, padding: "1.25rem", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="cd-text text-lg font-extrabold truncate">{s.companyName ?? "—"}</h3>
            <TypeTag type={s.signalType} />
            <GradeTag grade={s.signalGrade} />
            <MatchTypeTag type={s.matchType} />
          </div>
          <button className="cd-btn cd-btn-ghost cd-btn-sm shrink-0" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        {err && <div className="cd-error-bg cd-error-text rounded-lg px-3 py-2 text-xs mb-3">{err}</div>}

        <div className="rounded-xl border cd-border-c px-3 py-1.5 mb-3">
          <Row label="공시명" value={s.reportName ?? "—"} />
          <Row label="공시일" value={s.disclosedAt ?? "—"} />
          {s.assetClass && <Row label="자산구분" value={s.assetClass} />}
          {s.acquirePurpose && <Row label="취득목적" value={s.acquirePurpose} />}
          {s.amount != null && <Row label="취득금액" value={`${s.amount.toLocaleString()}원`} />}
          {s.counterparty && <Row label="거래상대방" value={s.counterparty} />}
          <Row label="사업자번호" value={s.brn ?? "—"} />
          <Row
            label={s.matchType === "counterparty" ? "발주처(대상)" : "매칭 사업장"}
            value={s.facilityName ?? <span className="cd-text-faint">미매칭</span>}
          />
          {s.matchType === "counterparty" && (
            <Row label="공시자" value={<span className="cd-text-muted">{s.companyName ?? "—"} (원문에서 발주처로 대상 검출)</span>} />
          )}
          <Row label="원문" value={s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="cd-text-primary inline-flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> DART 원문</a> : "—"} />
        </div>

        {/* 미매칭 시 사업장 수동 연결 */}
        {canEdit && !s.facilityId && (
          <div className="mb-3">
            <label className="cd-label">사업장 수동 연결</label>
            <div className="relative">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 cd-text-faint shrink-0" />
                <input className="cd-input" placeholder="사업장명 검색" value={facilityQuery} onChange={(e) => setFacilityQuery(e.target.value)} />
              </div>
              {facilityResults.length > 0 && (
                <div className="cd-card-bg rounded-lg border cd-border-c mt-1 max-h-40 overflow-y-auto">
                  {facilityResults.map((f) => (
                    <button key={f.facilityId} className="cd-row-hover w-full text-left px-3 py-2 cd-text text-sm" onClick={() => patch({ facilityId: f.facilityId })}>
                      {f.companyName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {canEdit && (
          <div className="flex justify-end gap-2">
            {s.status !== "dismissed" && (
              <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => patch({ status: "dismissed" })} disabled={busy}>
                <Ban className="w-4 h-4" /> 무시
              </button>
            )}
            {s.facilityId && !s.linkedProjectId && (
              <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={convert} disabled={busy}>
                <Plus className="w-4 h-4" /> 영업건 생성
              </button>
            )}
            {s.linkedProjectId && (
              <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={() => onConverted(s.linkedProjectId!)}>
                영업건 열기
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
