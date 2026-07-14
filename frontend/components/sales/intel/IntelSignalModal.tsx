"use client";

// 신호 상세 + 소스별 원문 모달(C-5) — 외부 링크 이동 대신 내용 자체를 표시한다.
//  DART: document.xml 텍스트를 서버 라우트로 받아 표시(원본 링크 보조)
//  EIASS: raw_json.detail(사업구분·시행자·규모·사업비 등) 구조화 표시 — 추가 fetch 없음
//  보도자료: raw_json.body(최대 3000자) 표시
//  NAVER: 요약(raw_json.classification.summary) + 원문 링크
//  고시: 직링크 유지(토지이음 상세/RSS)

import { useEffect, useRef, useState } from "react";
import { Ban, Building2, ExternalLink, FileText, Plus, RefreshCw, X } from "lucide-react";
import type { IntelSignal, IntelSignalDetail } from "./intel-shared";
import { GradeTag, INDUSTRY_LABEL, MatchTypeTag, RELEVANCE_LABEL, RelevanceTag, SOURCE_LABEL, TypeTag } from "./intel-shared";

interface FacilityOption {
  facilityId: string;
  companyName: string;
}

const EIASS_DETAIL_FIELDS: Array<{ key: string; label: string }> = [
  { key: "bizCategory", label: "사업구분" },
  { key: "operator", label: "사업시행자" },
  { key: "operatorKind", label: "시행자 구분" },
  { key: "region", label: "소재지" },
  { key: "scaleText", label: "사업규모" },
  { key: "approver", label: "승인기관" },
  { key: "agency", label: "협의기관" },
  { key: "evalAgent", label: "평가대행자" },
];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="cd-text-faint text-xs shrink-0" style={{ width: 84 }}>{label}</span>
      <span className="cd-text text-sm flex-1 min-w-0 break-words">{value}</span>
    </div>
  );
}

/** 소스별 원문 섹션 */
function SourceBody({ detail }: { detail: IntelSignalDetail }) {
  const raw = detail.rawJson ?? {};
  const [docText, setDocText] = useState<string | null>(null);
  const [docTruncated, setDocTruncated] = useState(false);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  const loadDoc = async () => {
    setDocLoading(true); setDocError(null);
    try {
      const res = await fetch(`/api/sales/intel/signals/${detail.signalId}/document`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setDocText(String(data.text ?? ""));
      setDocTruncated(!!data.truncated);
    } catch (e) {
      setDocError((e as Error).message);
    } finally {
      setDocLoading(false);
    }
  };

  if (detail.source === "dart") {
    return (
      <div className="rounded-xl border cd-border-c px-3 py-2 mb-3">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[12px] font-extrabold" style={{ color: "var(--cd-muted)" }}>공시 원문</span>
          {docText == null && (
            <button className="cd-btn cd-btn-soft cd-btn-sm" onClick={loadDoc} disabled={docLoading}>
              {docLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              {docLoading ? "불러오는 중…" : "원문 보기"}
            </button>
          )}
        </div>
        {docError && <div className="cd-error-bg cd-error-text rounded-lg px-3 py-2 text-xs mb-2">{docError}</div>}
        {docText != null && (
          <div className="cd-surface-bg rounded-lg px-3 py-2 max-h-64 overflow-y-auto">
            <pre className="cd-text text-xs whitespace-pre-wrap break-words font-sans leading-relaxed">{docText}</pre>
            {docTruncated && <p className="cd-text-faint text-[11px] mt-1">…이후 생략(전문은 DART 원본 링크에서)</p>}
          </div>
        )}
      </div>
    );
  }

  if (detail.source === "eiass") {
    const d = (raw.detail ?? {}) as Record<string, unknown>;
    const rows = EIASS_DETAIL_FIELDS.filter((f) => d[f.key] != null && String(d[f.key]).trim() !== "");
    return (
      <div className="rounded-xl border cd-border-c px-3 py-1.5 mb-3">
        <p className="text-[12px] font-extrabold pt-1.5" style={{ color: "var(--cd-muted)" }}>협의 상세</p>
        {rows.length === 0 && <p className="cd-text-faint text-xs py-2">상세 정보가 없습니다.</p>}
        {rows.map((f) => <Row key={f.key} label={f.label} value={String(d[f.key])} />)}
        {typeof d.costEokwon === "number" && <Row label="사업비" value={`${d.costEokwon.toLocaleString()}억원`} />}
        {typeof raw.status === "string" && raw.status && <Row label="진행상태" value={String(raw.status)} />}
        {detail.summary && <Row label="AI 요약" value={detail.summary} />}
      </div>
    );
  }

  if (detail.source === "press") {
    const body = typeof raw.body === "string" ? raw.body : null;
    return (
      <div className="rounded-xl border cd-border-c px-3 py-2 mb-3">
        {detail.summary && (
          <div className="cd-tint-primary rounded-lg px-3 py-2 text-xs cd-text mb-2">
            <b>AI 요약</b> · {detail.summary}
          </div>
        )}
        <p className="text-[12px] font-extrabold mb-1" style={{ color: "var(--cd-muted)" }}>보도자료 본문</p>
        {body ? (
          <div className="cd-surface-bg rounded-lg px-3 py-2 max-h-64 overflow-y-auto">
            <pre className="cd-text text-xs whitespace-pre-wrap break-words font-sans leading-relaxed">{body}</pre>
          </div>
        ) : (
          <p className="cd-text-faint text-xs py-1">저장된 본문이 없습니다. 원문 링크를 이용해 주세요.</p>
        )}
      </div>
    );
  }

  if (detail.source === "news") {
    const desc = typeof raw.description === "string" ? raw.description : null;
    return (
      <div className="rounded-xl border cd-border-c px-3 py-2 mb-3">
        {detail.summary ? (
          <div className="cd-tint-primary rounded-lg px-3 py-2 text-xs cd-text mb-2">
            <b>AI 요약</b> · {detail.summary}
          </div>
        ) : null}
        {desc && (
          <>
            <p className="text-[12px] font-extrabold mb-1" style={{ color: "var(--cd-muted)" }}>기사 요약문</p>
            <p className="cd-text text-xs leading-relaxed">{desc}</p>
          </>
        )}
        {!detail.summary && !desc && <p className="cd-text-faint text-xs py-1">요약 정보가 없습니다. 원문 링크를 이용해 주세요.</p>}
      </div>
    );
  }

  // gosi(토지이음·유역청): 모달 원문 불필요 — 직링크 유지
  return null;
}

export function IntelSignalModal({
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
  const [detail, setDetail] = useState<IntelSignalDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [facilityQuery, setFacilityQuery] = useState("");
  const [facilityResults, setFacilityResults] = useState<FacilityOption[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 원문(raw_json)·요약 포함 상세를 별도 로드 — 리스트 응답은 가볍게 유지
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/sales/intel/signals/${s.signalId}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
        if (alive) setDetail(data.signal);
      } catch {
        if (alive) setDetail({ ...s, summary: null, rawJson: null }); // 상세 실패 시 기본 정보만
      }
    })();
    return () => { alive = false; };
  }, [s]);

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

  return (
    <div className="cd-modal-overlay cdash cd-fields-white" data-theme={theme} onClick={onClose}>
      <div className="cd-modal cd-card-bg w-full" style={{ maxWidth: 560, padding: "1.25rem", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h3 className="cd-text text-lg font-extrabold truncate">{s.companyName ?? s.reportName ?? "—"}</h3>
            <TypeTag type={s.signalType} />
            <GradeTag grade={s.signalGrade} />
            <RelevanceTag relevance={s.industryRelevance} note={s.relevanceNote} />
            <MatchTypeTag type={s.matchType} />
          </div>
          <button className="cd-btn cd-btn-ghost cd-btn-sm shrink-0" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        {err && <div className="cd-error-bg cd-error-text rounded-lg px-3 py-2 text-xs mb-3">{err}</div>}

        <div className="rounded-xl border cd-border-c px-3 py-1.5 mb-3">
          <Row label={s.source === "news" || s.source === "press" ? "제목" : "공시명"} value={s.reportName ?? "—"} />
          <Row label={s.source === "dart" ? "공시일" : "게시일"} value={s.disclosedAt ? s.disclosedAt.slice(0, 10) : "—"} />
          <Row label="수집일" value={s.createdAt ? s.createdAt.slice(0, 10) : "—"} />
          {s.assetClass && <Row label="자산구분" value={s.assetClass} />}
          {s.acquirePurpose && <Row label="취득목적" value={s.acquirePurpose} />}
          {s.amount != null && <Row label={s.source === "eiass" ? "사업비" : "취득금액"} value={`${s.amount.toLocaleString()}원`} />}
          {s.counterparty && <Row label="거래상대방" value={s.counterparty} />}
          {s.industry && (
            <Row
              label="대상 업종"
              value={`${INDUSTRY_LABEL[s.industry] ?? s.industry}${s.industryRelevance ? ` (관련성 ${RELEVANCE_LABEL[s.industryRelevance] ?? s.industryRelevance})` : ""}`}
            />
          )}
          {s.relevanceNote && <Row label="유발 경로" value={s.relevanceNote} />}
          {s.brn && <Row label="사업자번호" value={s.brn} />}
          <Row
            label={s.matchType === "counterparty" ? "발주처(대상)" : "매칭 사업장"}
            value={s.facilityName ?? <span className="cd-text-faint">미매칭</span>}
          />
          {s.matchType === "counterparty" && (
            <Row label="공시자" value={<span className="cd-text-muted">{s.companyName ?? "—"} (원문에서 발주처로 대상 검출)</span>} />
          )}
          <Row
            label="원문 링크"
            value={s.url ? (
              <a href={s.url} target="_blank" rel="noreferrer" className="cd-text-primary inline-flex items-center gap-1">
                <ExternalLink className="w-3.5 h-3.5" /> {SOURCE_LABEL[s.source] ?? s.source} 원문
              </a>
            ) : "—"}
          />
        </div>

        {/* 소스별 원문 — 상세 로드 후 표시 */}
        {detail ? <SourceBody detail={detail} /> : (
          <div className="cd-text-faint text-xs px-1 pb-3">원문 정보를 불러오는 중…</div>
        )}

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
