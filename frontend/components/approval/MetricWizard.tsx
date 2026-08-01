"use client";

// 지표 설정 마법사(SW-P3) — 코딩 지식 없는 관리자가 단계별로 지표를 조립한다.
// 흐름: 템플릿/자연어 → 소스·측정값 → 계산(문장형) → 연결 확인 → 미리보기·품질 리포트 → 저장.
// 복합(수식) 지표는 소스 대신 수식 빌더 단계를 거친다. 정의는 전부 선언 JSON — 실행은 서버 엔진.
// 설계: docs/semantic-analytics-wizard-blueprint.md §5.

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Sparkles, X } from "lucide-react";
import {
  AGG_LABEL,
  DIMENSION_LABEL,
  METRIC_AGGS,
  SYSTEM_SOURCE_CATALOG,
  formatMetricValue,
  validateDefinition,
  type AggregateDefinition,
  type CompositeDefinition,
  type MetricAgg,
  type MetricDefinition,
  type MetricItem,
  type MetricResult,
} from "@/lib/analytics/metric-types";
import type { SemanticConceptItem } from "@/lib/approval/semantic-concepts";

interface EdgeSummary {
  formName: string;
  entity: string;
  totalDocs: number;
  linkedDocs: number;
  manualDocs: number;
  missingDocs: number;
}

const EXCLUDE_LABEL: Record<string, string> = {
  noGroupKey: "참조 미입력",
  manualRef: "직접 입력(마스터 미연결)",
  emptyValue: "값 비어 있음",
  emptyDoc: "문서 값 없음",
  formWithoutRefField: "양식에 참조 필드 없음",
};

/** 템플릿 갤러리 — 시드 지표들의 원형(§5 STEP 0) */
const TEMPLATES: { title: string; desc: string; def: MetricDefinition }[] = [
  {
    title: "용역별 비용 집계",
    desc: "결재 문서의 비용 태그 금액을 관련 용역별로 합산 (예: 용역별 출장 경비)",
    def: { kind: "aggregate", source: { type: "approval_docs", forms: "auto", status: ["approved"] }, measure: { agg: "sum", concept: "cost.travel" }, groupBy: ["ref.contract"] },
  },
  {
    title: "비용 분류별 월 추이",
    desc: "지출 내역의 분류(교통비·숙박비 등)별 월 합계 — 비용 절감 요소 탐색",
    def: { kind: "aggregate", source: { type: "approval_docs", forms: "auto", status: ["approved"] }, measure: { agg: "sum", concept: "cost.travel" }, groupBy: ["dim.category"], timeBy: { concept: "when.occurred", bucket: "month" } },
  },
  {
    title: "인원별 초과근무",
    desc: "ADT 근태 실측의 인정 연장 시간을 인원·월별로 집계",
    def: { kind: "aggregate", source: { type: "system.attendance" }, measure: { agg: "sum", field: "overtime_hours" }, groupBy: ["ref.employee"], timeBy: { field: "week_start", bucket: "month" } },
  },
  {
    title: "인원별 수행 용역 수",
    desc: "수행인력 원장 기준 참여 계약 수(중복 제거)",
    def: { kind: "aggregate", source: { type: "system.participants" }, measure: { agg: "count_distinct", field: "contract_id" }, groupBy: ["ref.employee"] },
  },
  {
    title: "비율·마진(복합 수식)",
    desc: "기존 지표들을 사칙연산으로 결합 (예: (계약금액 − 비용) ÷ 계약금액)",
    def: { kind: "composite", dimensions: ["ref.contract"], formula: ["(", "contract_amount_by_contract", "-", "travel_cost_by_contract", ")", "/", "contract_amount_by_contract"], format: "percent" },
  },
];

export function MetricWizard({
  theme,
  metrics,
  onClose,
  onSaved,
}: {
  theme: string;
  metrics: MetricItem[];
  onClose: () => void;
  onSaved: (metricKey: string) => void;
}) {
  // step: 0=템플릿 1=소스·측정값 2=계산 3=연결확인 4=미리보기·저장 (composite 는 1~3 대신 10=수식)
  const [step, setStep] = useState(0);
  const [def, setDef] = useState<MetricDefinition | null>(null);
  const [meta, setMeta] = useState({ metricKey: "", label: "", description: "", visibility: "admin" as MetricItem["visibility"] });
  const [concepts, setConcepts] = useState<SemanticConceptItem[]>([]);
  const [edges, setEdges] = useState<EdgeSummary[] | null>(null);
  const [preview, setPreview] = useState<MetricResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nlPrompt, setNlPrompt] = useState("");

  useEffect(() => {
    fetch("/api/approval/semantic-concepts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { concepts: [] }))
      .then((d) => setConcepts(d.concepts ?? []))
      .catch(() => {});
  }, []);

  const agg = def?.kind === "aggregate" ? def : null;
  const comp = def?.kind === "composite" ? def : null;
  const isDocSource = agg?.source.type === "approval_docs";
  const sysSpec = SYSTEM_SOURCE_CATALOG.find((s) => s.key === agg?.source.type);

  /** 측정값 후보 태그 — 금액/숫자에 붙는 개념(비용·수익·수량) */
  const measureConcepts = useMemo(
    () => concepts.filter((c) => !c.auto && c.active && c.appliesTo.some((t) => t === "currency" || t === "number")),
    [concepts]
  );

  const patchAgg = (patch: Partial<AggregateDefinition>) => setDef((d) => (d?.kind === "aggregate" ? { ...d, ...patch } : d));
  const patchComp = (patch: Partial<CompositeDefinition>) => setDef((d) => (d?.kind === "composite" ? { ...d, ...patch } : d));

  const start = (d: MetricDefinition, label?: string, description?: string) => {
    setDef(JSON.parse(JSON.stringify(d)));
    if (label != null) setMeta((m) => ({ ...m, label, description: description ?? m.description }));
    setPreview(null);
    setStep(d.kind === "composite" ? 10 : 1);
  };

  const suggest = async () => {
    if (!nlPrompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/approval/metrics/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: nlPrompt }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "초안 생성 실패");
      start(body.definition, body.label, body.description);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadEdges = async () => {
    const groupBy = agg?.groupBy?.find((g) => g.startsWith("ref."));
    if (!groupBy || !isDocSource) {
      setEdges([]);
      return;
    }
    try {
      const res = await fetch("/api/approval/semantics", { cache: "no-store" });
      const body = await res.json();
      if (res.ok) {
        const entity = groupBy.replace("ref.", "");
        setEdges(
          (body.edges ?? [])
            .filter((e: { entity: string }) => e.entity === entity)
            .map((e: EdgeSummary & { formName: string }) => e)
        );
      }
    } catch {
      setEdges([]);
    }
  };

  const runPreview = async () => {
    if (!def) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/approval/metrics/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition: def, label: meta.label || "미리보기" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "미리보기 실패");
      setPreview(body.result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!def) return;
    const key = meta.metricKey.trim();
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      setError("지표 키는 영문 소문자·숫자·_ 로 입력하세요 (예: travel_cost_by_dept).");
      return;
    }
    if (!meta.label.trim()) {
      setError("지표 이름을 입력하세요.");
      return;
    }
    const verr = validateDefinition(def);
    if (verr) {
      setError(verr);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/approval/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metric: { metricKey: key, label: meta.label, description: meta.description || null, definition: def, visibility: meta.visibility, active: true },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "저장 실패");
      onSaved(key);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const goNextFrom = (s: number) => {
    if (s === 2) {
      loadEdges();
      setStep(3);
    } else if (s === 3 || s === 10) {
      runPreview();
      setStep(4);
    } else setStep(s + 1);
  };

  const stepTitle =
    step === 0 ? "무엇을 알고 싶으세요?"
    : step === 1 ? "1단계 — 어떤 데이터에서 집계할까요?"
    : step === 2 ? "2단계 — 어떻게 계산할까요?"
    : step === 3 ? "3단계 — 연결 상태 확인"
    : step === 10 ? "수식 구성 — 기존 지표를 결합합니다"
    : "마지막 — 미리보기 확인 후 저장";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: "rgba(23, 28, 44, 0.42)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)" }}
      onClick={onClose}
    >
      <div
        className="cdash cdash-vars cd-fields-white rounded-[24px] border cd-border-c w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6 flex flex-col gap-4"
        style={{ background: "var(--cd-card-solid)" }}
        data-theme={theme}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <h3 className="font-bold cd-text text-[15px]">{stepTitle}</h3>
          <button type="button" className="ml-auto cd-btn cd-btn-soft text-[12px]" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>
        {error && <p className="text-[12px] cd-error-text">{error}</p>}

        {/* ── STEP 0: 템플릿 갤러리 + 자연어 ── */}
        {step === 0 && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.title}
                  type="button"
                  className="rounded-2xl border cd-border-c px-4 py-3 text-left cd-row-hover"
                  onClick={() => start(t.def, t.title)}
                >
                  <span className="block text-[13px] font-bold cd-text">{t.title}</span>
                  <span className="block text-[11px] cd-text-faint mt-1 leading-relaxed">{t.desc}</span>
                </button>
              ))}
              <button
                type="button"
                className="rounded-2xl border border-dashed cd-border-c px-4 py-3 text-left cd-row-hover"
                onClick={() =>
                  start({ kind: "aggregate", source: { type: "approval_docs", forms: "auto", status: ["approved"] }, measure: { agg: "sum", concept: measureConcepts[0]?.key ?? "cost.travel" }, groupBy: ["ref.contract"] })
                }
              >
                <span className="block text-[13px] font-bold cd-text">백지에서 시작</span>
                <span className="block text-[11px] cd-text-faint mt-1">소스·계산을 직접 구성합니다.</span>
              </button>
            </div>
            <div className="rounded-2xl border cd-border-c p-3.5 flex flex-col gap-2">
              <span className="text-[12px] font-bold cd-text flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 cd-text-primary" /> 문장으로 설명하면 AI가 초안을 만듭니다
              </span>
              <div className="flex items-center gap-2">
                <input
                  className="cd-input flex-1 text-[12.5px]"
                  placeholder="예: 부서 회식비가 달마다 얼마나 나가는지 보고 싶어"
                  value={nlPrompt}
                  onChange={(e) => setNlPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && suggest()}
                />
                <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50" disabled={busy || !nlPrompt.trim()} onClick={suggest}>
                  {busy ? "생성 중..." : "AI 초안"}
                </button>
              </div>
              <p className="text-[10.5px] cd-text-faint">AI는 정의 초안만 제안하고, 계산은 등록된 태그·소스 범위에서만 실행됩니다.</p>
            </div>
          </div>
        )}

        {/* ── STEP 1: 소스·측정값 ── */}
        {step === 1 && agg && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <button
                type="button"
                className={`rounded-2xl border px-4 py-3 text-left ${isDocSource ? "cd-glass-active" : "cd-border-c cd-row-hover"}`}
                onClick={() => patchAgg({ source: { type: "approval_docs", forms: "auto", status: ["approved"] }, measure: { agg: "sum", concept: measureConcepts[0]?.key ?? "cost.travel" } })}
              >
                <span className="block text-[13px] font-bold cd-text">결재 문서</span>
                <span className="block text-[11px] cd-text-faint mt-1">양식에 태깅된 값(출장 경비 등)을 집계 — 태그를 가진 모든 양식이 자동 포함됩니다.</span>
              </button>
              {SYSTEM_SOURCE_CATALOG.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`rounded-2xl border px-4 py-3 text-left ${agg.source.type === s.key ? "cd-glass-active" : "cd-border-c cd-row-hover"}`}
                  onClick={() => patchAgg({ source: { type: s.key }, measure: { agg: s.measures[0].defaultAgg, field: s.measures[0].key }, groupBy: [s.dims[0].key], timeBy: undefined })}
                >
                  <span className="block text-[13px] font-bold cd-text">{s.label}</span>
                  <span className="block text-[11px] cd-text-faint mt-1">{s.measures.map((m) => m.label).join(" · ")}</span>
                </button>
              ))}
            </div>
            <label className="text-[11.5px] cd-text-faint flex items-center gap-2 flex-wrap">
              집계할 값:
              {isDocSource ? (
                <>
                  <select
                    className="cd-select"
                    style={{ width: 220 }}
                    value={agg.measure.concept ?? ""}
                    onChange={(e) => patchAgg({ measure: { ...agg.measure, concept: e.target.value } })}
                  >
                    {measureConcepts.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.group} · {c.label}
                      </option>
                    ))}
                  </select>
                  <span>문서 상태:</span>
                  <select
                    className="cd-select"
                    style={{ width: 130 }}
                    value={(agg.source.status ?? ["approved"]).join(",")}
                    onChange={(e) => patchAgg({ source: { ...agg.source, status: e.target.value.split(",") } })}
                  >
                    <option value="approved">승인 문서만</option>
                    <option value="approved,in_progress">승인+진행 중</option>
                  </select>
                </>
              ) : (
                <select
                  className="cd-select"
                  style={{ width: 240 }}
                  value={agg.measure.field ?? ""}
                  onChange={(e) => {
                    const m = sysSpec?.measures.find((x) => x.key === e.target.value);
                    patchAgg({ measure: { agg: m?.defaultAgg ?? "sum", field: e.target.value } });
                  }}
                >
                  {(sysSpec?.measures ?? []).map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
            </label>
          </div>
        )}

        {/* ── STEP 2: 계산(문장형) ── */}
        {step === 2 && agg && (
          <div className="flex flex-col gap-3">
            <div className="rounded-2xl border cd-border-c p-4 text-[13.5px] cd-text leading-loose">
              <b className="cd-text-primary">
                {isDocSource ? measureConcepts.find((c) => c.key === agg.measure.concept)?.label ?? agg.measure.concept : sysSpec?.measures.find((m) => m.key === agg.measure.field)?.label}
              </b>
              을(를){" "}
              <select className="cd-select mx-1" style={{ width: 110, display: "inline-block" }} value={agg.measure.agg} onChange={(e) => patchAgg({ measure: { ...agg.measure, agg: e.target.value as MetricAgg } })}>
                {METRIC_AGGS.map((a) => (
                  <option key={a} value={a}>
                    {AGG_LABEL[a]}
                  </option>
                ))}
              </select>
              로,{" "}
              <select
                className="cd-select mx-1"
                style={{ width: 150, display: "inline-block" }}
                value={agg.groupBy?.[0] ?? ""}
                onChange={(e) => {
                  const first = e.target.value;
                  const second = agg.groupBy?.[1];
                  patchAgg({ groupBy: first ? (second && second !== first ? [first, second] : [first]) : undefined });
                }}
              >
                <option value="">전체(그룹 없음)</option>
                {(isDocSource
                  ? ["ref.contract", "ref.company", "ref.employee", "dim.category"]
                  : (sysSpec?.dims ?? []).map((d) => d.key)
                ).map((k) => (
                  <option key={k} value={k}>
                    {DIMENSION_LABEL[k] ?? k}
                  </option>
                ))}
              </select>
              {agg.groupBy?.[0] && (
                <>
                  {" "}×{" "}
                  <select
                    className="cd-select mx-1"
                    style={{ width: 150, display: "inline-block" }}
                    value={agg.groupBy?.[1] ?? ""}
                    onChange={(e) => patchAgg({ groupBy: e.target.value ? [agg.groupBy![0], e.target.value] : [agg.groupBy![0]] })}
                  >
                    <option value="">2차 그룹 없음</option>
                    {(isDocSource
                      ? agg.groupBy[0].startsWith("ref.")
                        ? ["dim.category"]
                        : ["ref.contract", "ref.company", "ref.employee"]
                      : (sysSpec?.dims ?? []).map((d) => d.key).filter((k) => k !== agg.groupBy![0])
                    ).map((k) => (
                      <option key={k} value={k}>
                        {DIMENSION_LABEL[k] ?? k}
                      </option>
                    ))}
                  </select>
                </>
              )}
              별,{" "}
              <select
                className="cd-select mx-1"
                style={{ width: 130, display: "inline-block" }}
                value={agg.timeBy ? agg.timeBy.bucket : ""}
                onChange={(e) => {
                  const bucket = e.target.value as "" | "month" | "year";
                  if (!bucket) patchAgg({ timeBy: undefined });
                  else if (isDocSource) patchAgg({ timeBy: { concept: "when.occurred", bucket } });
                  else patchAgg({ timeBy: { field: sysSpec?.times[0]?.key, bucket } });
                }}
              >
                <option value="">전체 기간 합산</option>
                <option value="month">월 단위</option>
                <option value="year">연 단위</option>
              </select>
              으로 집계합니다.
            </div>
            {agg.groupBy?.includes("ref.employee") && (
              <p className="text-[11px] cd-text-faint rounded-lg border border-dashed cd-border-c p-2.5">
                인원별 지표는 인사 민감 정보입니다 — 공개 범위 기본값이 &quot;관리자만&quot;으로 저장됩니다.
              </p>
            )}
          </div>
        )}

        {/* ── STEP 3: 연결 확인 ── */}
        {step === 3 && agg && (
          <div className="flex flex-col gap-3">
            {!agg.groupBy?.some((g) => g.startsWith("ref.")) || !isDocSource ? (
              <p className="text-[12.5px] cd-text-faint rounded-2xl border cd-border-c p-4">
                {isDocSource ? "분류·전체 집계는 별도 연결이 필요 없습니다." : "시스템 소스는 마스터 데이터라 연결 확인이 필요 없습니다."} 다음으로 진행하세요.
              </p>
            ) : edges == null ? (
              <p className="text-[12px] cd-text-faint">연결 상태 조회 중...</p>
            ) : (
              <>
                <p className="text-[12px] cd-text-faint">
                  문서가 {DIMENSION_LABEL[agg.groupBy?.find((g) => g.startsWith("ref.")) ?? ""] ?? "참조 대상"}에 얼마나 연결되어 있는지입니다. 미연결·직접 입력 문서는 집계에서 제외되고, 제외 건수는 결과의 산출 근거에 표시됩니다.
                </p>
                {edges.length === 0 && <p className="text-[12px] cd-text-faint">아직 제출 문서가 없거나 해당 참조 필드를 가진 양식이 없습니다.</p>}
                {edges.map((e, i) => {
                  const rate = e.totalDocs ? Math.round((e.linkedDocs / e.totalDocs) * 100) : null;
                  return (
                    <div key={i} className="rounded-xl border cd-border-c px-3.5 py-2.5 text-[12px] cd-text flex items-center gap-3 flex-wrap">
                      <b>{e.formName}</b>
                      <span className="cd-text-faint">총 {e.totalDocs}건</span>
                      <span style={{ color: "var(--cd-primary,#5D87FF)" }}>연결 {e.linkedDocs}</span>
                      <span style={{ color: "var(--cd-warning,#FFAE1F)" }}>직접 입력 {e.manualDocs}</span>
                      <span style={{ color: "var(--cd-danger,#FA896B)" }}>미입력 {e.missingDocs}</span>
                      <span className="ml-auto font-bold">{rate == null ? "-" : `${rate}%`}</span>
                    </div>
                  );
                })}
                <p className="text-[10.5px] cd-text-faint">
                  연결률이 낮으면 <a href="/approval/semantics" className="cd-text-primary underline underline-offset-2">데이터 관계 맵</a>에서 미연결 문서를 확인하세요.
                </p>
              </>
            )}
          </div>
        )}

        {/* ── STEP 10: 복합 수식 빌더 ── */}
        {step === 10 && comp && (
          <div className="flex flex-col gap-3">
            <label className="text-[11.5px] cd-text-faint flex items-center gap-2">
              결합 차원:
              <select className="cd-select" style={{ width: 150 }} value={comp.dimensions[0] ?? "ref.contract"} onChange={(e) => patchComp({ dimensions: [e.target.value] })}>
                {Object.entries(DIMENSION_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <span>표시:</span>
              <select className="cd-select" style={{ width: 110 }} value={comp.format ?? "number"} onChange={(e) => patchComp({ format: e.target.value as CompositeDefinition["format"] })}>
                <option value="number">숫자</option>
                <option value="currency">금액</option>
                <option value="percent">퍼센트</option>
              </select>
            </label>
            <div className="rounded-2xl border cd-border-c p-3 min-h-[52px] flex items-center gap-1.5 flex-wrap">
              {comp.formula.length === 0 && <span className="text-[12px] cd-text-faint">아래에서 지표와 연산자를 눌러 수식을 만드세요.</span>}
              {comp.formula.map((t, i) => (
                <button
                  key={i}
                  type="button"
                  title="클릭하면 제거"
                  className={`rounded-lg border px-2 py-1 text-[11.5px] font-mono ${/^[a-z]/.test(t) ? "cd-glass-active" : "cd-border-c cd-text"}`}
                  onClick={() => patchComp({ formula: comp.formula.filter((_, x) => x !== i) })}
                >
                  {/^[a-z]/.test(t) ? metrics.find((m) => m.metricKey === t)?.label ?? t : t}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {metrics
                .filter((m) => m.definition.kind === "aggregate")
                .map((m) => (
                  <button key={m.metricKey} type="button" className="rounded-lg border cd-border-c px-2 py-1 text-[11px] cd-row-hover cd-text" onClick={() => patchComp({ formula: [...comp.formula, m.metricKey] })}>
                    {m.label}
                  </button>
                ))}
              {["+", "-", "*", "/", "(", ")"].map((op) => (
                <button key={op} type="button" className="rounded-lg border cd-border-c px-2.5 py-1 text-[12px] font-mono cd-row-hover cd-text-primary" onClick={() => patchComp({ formula: [...comp.formula, op] })}>
                  {op}
                </button>
              ))}
              <button type="button" className="rounded-lg border border-dashed cd-border-c px-2 py-1 text-[11px] cd-text-faint" onClick={() => patchComp({ formula: [] })}>
                지우기
              </button>
            </div>
            <p className="text-[10.5px] cd-text-faint">참조 지표들은 결합 차원({DIMENSION_LABEL[comp.dimensions[0] ?? ""] ?? comp.dimensions[0]})별 집계여야 하며, 값이 없는 그룹은 0으로 계산됩니다.</p>
          </div>
        )}

        {/* ── STEP 4: 미리보기·품질 리포트·저장 ── */}
        {step === 4 && (
          <div className="flex flex-col gap-3">
            {busy && <p className="text-[12px] cd-text-faint">실데이터로 계산 중...</p>}
            {preview && (
              <>
                <div className="rounded-xl border border-dashed cd-border-c px-3 py-2 text-[11px] cd-text-faint leading-relaxed">
                  <b className="cd-text">품질 리포트</b> — 소스 {preview.diagnostics.sources.join(", ")}
                  {preview.diagnostics.totalDocs != null && <> · 대상 문서 {preview.diagnostics.totalDocs}건</>} · 사용 {preview.diagnostics.usedRows}행
                  {Object.entries(preview.diagnostics.excluded).length > 0 && (
                    <> · 제외: {Object.entries(preview.diagnostics.excluded).map(([k, v]) => `${EXCLUDE_LABEL[k.split(".").pop() ?? k] ?? k} ${v}건`).join(", ")}</>
                  )}
                  {preview.diagnostics.notes.map((n, i) => (
                    <span key={i} className="block">{n}</span>
                  ))}
                </div>
                <div className="overflow-x-auto max-h-[240px] overflow-y-auto rounded-xl border cd-border-c">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-left cd-text-faint text-[11px]">
                        <th className="py-1.5 px-2 font-semibold">구분</th>
                        {preview.hasTime && <th className="py-1.5 px-2 font-semibold">기간</th>}
                        <th className="py-1.5 px-2 font-semibold text-right">값</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 20).map((r, i) => (
                        <tr key={i} className="border-t cd-border-c">
                          <td className="py-1.5 px-2 cd-text">{r.groupLabel}</td>
                          {preview.hasTime && <td className="py-1.5 px-2 cd-text-faint">{r.time ?? "-"}</td>}
                          <td className="py-1.5 px-2 text-right font-bold cd-text">{formatMetricValue(r.value, preview.format)}</td>
                        </tr>
                      ))}
                      {preview.rows.length === 0 && (
                        <tr>
                          <td colSpan={preview.hasTime ? 3 : 2} className="py-5 text-center text-[12px] cd-text-faint">
                            아직 결과가 없습니다 — 데이터가 쌓이면 채워집니다(품질 리포트의 제외 사유 참고).
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <label className="text-[11px] cd-text-faint flex flex-col gap-1">
                지표 이름
                <input className="cd-input" value={meta.label} onChange={(e) => setMeta({ ...meta, label: e.target.value })} />
              </label>
              <label className="text-[11px] cd-text-faint flex flex-col gap-1">
                지표 키(영문 소문자·숫자·_)
                <input className="cd-input font-mono" placeholder="travel_cost_by_dept" value={meta.metricKey} onChange={(e) => setMeta({ ...meta, metricKey: e.target.value })} />
              </label>
              <label className="text-[11px] cd-text-faint flex flex-col gap-1 md:col-span-2">
                설명(선택)
                <input className="cd-input" value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
              </label>
              <label className="text-[11px] cd-text-faint flex items-center gap-2">
                공개 범위
                <select className="cd-select" style={{ width: 130 }} value={meta.visibility} onChange={(e) => setMeta({ ...meta, visibility: e.target.value as MetricItem["visibility"] })}>
                  <option value="admin">관리자만</option>
                  <option value="all">전체 공개</option>
                  <option value="owner">작성자만</option>
                </select>
              </label>
            </div>
          </div>
        )}

        {/* ── 하단 내비게이션 ── */}
        {step > 0 && (
          <div className="flex items-center gap-2 pt-2 border-t cd-border-c">
            <button
              type="button"
              className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1"
              onClick={() => setStep(step === 4 ? (def?.kind === "composite" ? 10 : 3) : step === 10 ? 0 : step - 1)}
            >
              <ArrowLeft className="w-3.5 h-3.5" /> 이전
            </button>
            {step !== 4 ? (
              <button type="button" className="ml-auto cd-btn cd-btn-primary rounded-lg px-4 py-2 text-xs font-semibold" onClick={() => goNextFrom(step)}>
                다음 <ArrowRight className="w-3.5 h-3.5 inline ml-1" />
              </button>
            ) : (
              <span className="ml-auto flex items-center gap-2">
                <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs" disabled={busy} onClick={runPreview}>
                  다시 계산
                </button>
                <button type="button" className="cd-btn cd-btn-primary rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50" disabled={busy} onClick={save}>
                  <Check className="w-3.5 h-3.5 inline mr-1" /> 지표 저장
                </button>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
