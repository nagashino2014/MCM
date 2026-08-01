"use client";

// 데이터 관계 맵(/approval/semantics, admin) — SW-P1.
// 양식(왼쪽)과 마스터 엔티티(오른쪽)를 엔티티 참조 필드로 잇는 이분 그래프 + 연결 품질 진단.
// 관계는 설정하는 것이 아니라 태그에서 자동 도출되며, 이 화면의 역할은 "확인과 진단":
// 연결 성공률·직접 입력·미연결 문서를 실측해 보여주고, 채널 정책 위반·미태깅을 경고한다.
// 설계: docs/semantic-analytics-wizard-blueprint.md §4-2·§4-4.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Database, FileText, Link2, RefreshCw } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { ApprovalDocModal } from "@/components/approval/ApprovalDocModal";
import "@/components/cdash/cdash.css";

interface RefEdge {
  formId: string;
  formName: string;
  fieldKey: string;
  fieldLabel: string;
  concept: string;
  entity: string;
  entityLabel: string;
  totalDocs: number;
  linkedDocs: number;
  manualDocs: number;
  missingDocs: number;
}
interface FormNode {
  formId: string;
  name: string;
  version: number;
  submittedDocs: number;
  untaggedCount: number;
  taggedConcepts: string[];
}
interface Overview {
  forms: FormNode[];
  edges: RefEdge[];
  systemSources: { key: string; label: string; desc: string; rows: number | null }[];
  warnings: { kind: string; formId: string; formName: string; message: string }[];
}
interface MissingDoc {
  docId: string;
  docNo: string | null;
  status: string;
  drafterName: string | null;
  submittedAt: string | null;
  manual: boolean;
}

const ENTITY_ORDER = ["contract", "company", "employee", "dept"] as const;
const ENTITY_LABEL: Record<string, string> = { contract: "계약(용역)", company: "업체(사업장)", employee: "직원", dept: "부서" };

/** 이분 그래프 좌표 상수 — 행 기반 배치라 측정 없이 SVG 연결선을 그릴 수 있다. */
const ROW_H = 72;
const TOP_PAD = 8;
const NODE_H = 56;

function edgeRate(e: RefEdge): number | null {
  return e.totalDocs > 0 ? e.linkedDocs / e.totalDocs : null;
}
function rateColor(rate: number | null): string {
  if (rate == null) return "var(--cd-border, #DFE5EF)";
  if (rate >= 0.9) return "var(--cd-primary, #5D87FF)";
  if (rate >= 0.6) return "var(--cd-warning, #FFAE1F)";
  return "var(--cd-danger, #FA896B)";
}

export function ApprovalSemanticsBoard() {
  const { theme } = useCdashTheme();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RefEdge | null>(null);
  const [missingDocs, setMissingDocs] = useState<MissingDoc[] | null>(null);
  const [missingLoading, setMissingLoading] = useState(false);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/approval/semantics", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "진단 데이터를 불러오지 못했습니다.");
      setData(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const openMissing = async (e: RefEdge) => {
    setMissingLoading(true);
    setMissingDocs(null);
    try {
      const res = await fetch(
        `/api/approval/semantics?formId=${encodeURIComponent(e.formId)}&fieldKey=${encodeURIComponent(e.fieldKey)}`,
        { cache: "no-store" }
      );
      const body = await res.json();
      if (res.ok) setMissingDocs(body.docs ?? []);
    } finally {
      setMissingLoading(false);
    }
  };

  const selectEdge = (e: RefEdge) => {
    setSelected(e);
    setMissingDocs(null);
    if (e.missingDocs + e.manualDocs > 0) openMissing(e);
  };

  // 엔티티 노드: 엣지에 등장하는 것만, 고정 순서
  const entities = useMemo(() => {
    const present = new Set((data?.edges ?? []).map((e) => e.entity));
    return ENTITY_ORDER.filter((k) => present.has(k));
  }, [data]);

  const forms = data?.forms ?? [];
  const graphH = Math.max(forms.length, entities.length) * ROW_H + TOP_PAD * 2;

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="데이터 관계 맵"
        meta={data ? `양식 ${forms.length} · 연결 ${data.edges.length} · 경고 ${data.warnings.length}` : undefined}
        actions={
          <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5" /> 새로 고침
          </button>
        }
      />
      {error && <p className="text-sm cd-error-text">{error}</p>}
      {loading ? (
        <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
      ) : data ? (
        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-4 overflow-y-auto xl:overflow-visible">
          {/* ── 좌: 관계 맵 + 시스템 소스 ── */}
          <div className="flex flex-col gap-4 min-w-0 xl:overflow-y-auto">
            <div className="cd-card p-5 gap-3">
              <h3 className="font-bold cd-text text-[13.5px] flex items-center gap-1.5">
                <Link2 className="w-4 h-4 cd-text-primary" /> 양식 ↔ 마스터 데이터 연결
              </h3>
              <p className="text-[11px] cd-text-faint -mt-1">
                연결은 양식의 검색 필드(계약·업체·인원)에서 자동으로 도출됩니다. 선을 클릭하면 연결 품질 상세를 확인할 수 있습니다.
              </p>
              <div className="grid grid-cols-[1fr_120px_1fr] items-start" style={{ minHeight: graphH }}>
                {/* 양식 노드 */}
                <div className="flex flex-col" style={{ paddingTop: TOP_PAD }}>
                  {forms.map((f) => (
                    <div key={f.formId} style={{ height: ROW_H }} className="flex items-start">
                      <div
                        className={`w-full rounded-xl border px-3 py-2 ${
                          selected?.formId === f.formId ? "cd-glass-active" : "cd-border-c"
                        }`}
                        style={{ height: NODE_H, background: selected?.formId === f.formId ? undefined : "var(--cd-card-solid)" }}
                      >
                        <span className="block text-[12px] font-bold cd-text truncate">
                          <FileText className="w-3 h-3 inline mr-1 cd-text-faint" />
                          {f.name}
                        </span>
                        <span className="block text-[10.5px] cd-text-faint">
                          제출 {f.submittedDocs}건 · v{f.version}
                          {f.untaggedCount > 0 && <span className="text-[color:var(--cd-warning,#FFAE1F)]"> · 미태깅 {f.untaggedCount}</span>}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {/* 연결선(SVG) — 행 index 기반 좌표 */}
                <svg width="100%" height={graphH} viewBox={`0 0 120 ${graphH}`} preserveAspectRatio="none" className="block">
                  {data.edges.map((e, i) => {
                    const fi = forms.findIndex((f) => f.formId === e.formId);
                    const ei = entities.findIndex((k) => k === e.entity);
                    if (fi < 0 || ei < 0) return null;
                    const y1 = TOP_PAD + fi * ROW_H + NODE_H / 2;
                    const y2 = TOP_PAD + ei * ROW_H + NODE_H / 2;
                    const on = selected && selected.formId === e.formId && selected.fieldKey === e.fieldKey;
                    return (
                      <path
                        key={i}
                        d={`M 0 ${y1} C 60 ${y1}, 60 ${y2}, 120 ${y2}`}
                        fill="none"
                        stroke={rateColor(edgeRate(e))}
                        strokeWidth={on ? 4 : 2.5}
                        opacity={selected && !on ? 0.25 : 0.9}
                        style={{ cursor: "pointer" }}
                        onClick={() => selectEdge(e)}
                      />
                    );
                  })}
                </svg>
                {/* 엔티티 노드 */}
                <div className="flex flex-col" style={{ paddingTop: TOP_PAD }}>
                  {entities.map((k) => (
                    <div key={k} style={{ height: ROW_H }} className="flex items-start">
                      <div
                        className={`w-full rounded-xl border px-3 py-2 ${selected?.entity === k ? "cd-glass-active" : "cd-border-c"}`}
                        style={{ height: NODE_H, background: selected?.entity === k ? undefined : "var(--cd-card-solid)" }}
                      >
                        <span className="block text-[12px] font-bold cd-text">
                          <Database className="w-3 h-3 inline mr-1 cd-text-faint" />
                          {ENTITY_LABEL[k]}
                        </span>
                        <span className="block text-[10.5px] cd-text-faint">
                          연결 양식 {data.edges.filter((e) => e.entity === k).length}개
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* 엣지 리스트(선 클릭이 어려운 환경 대비) */}
              <div className="flex flex-wrap gap-1.5 pt-1 border-t cd-border-c">
                {data.edges.map((e, i) => {
                  const rate = edgeRate(e);
                  const on = selected && selected.formId === e.formId && selected.fieldKey === e.fieldKey;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => selectEdge(e)}
                      className={`rounded-lg border px-2 py-1 text-[10.5px] ${on ? "cd-glass-active" : "cd-border-c cd-text-faint cd-row-hover"}`}
                    >
                      {e.formName} → {e.entityLabel}
                      <b className="ml-1" style={{ color: rateColor(rate) }}>
                        {rate == null ? "문서 없음" : `${Math.round(rate * 100)}%`}
                      </b>
                    </button>
                  );
                })}
                {data.edges.length === 0 && <span className="text-[11px] cd-text-faint">엔티티 참조 필드를 가진 양식이 없습니다.</span>}
              </div>
            </div>

            {/* 시스템 소스 카탈로그 */}
            <div className="cd-card p-5 gap-3">
              <h3 className="font-bold cd-text text-[13.5px] flex items-center gap-1.5">
                <Database className="w-4 h-4 cd-text-primary" /> 시스템 데이터 소스
              </h3>
              <p className="text-[11px] cd-text-faint -mt-1">결재 문서 밖의 분석 소스 — 지표 마법사(SW-P2)에서 결합해 사용합니다.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {data.systemSources.map((s) => (
                  <div key={s.key} className="rounded-xl border cd-border-c px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-bold cd-text">{s.label}</span>
                      <span className="ml-auto text-[11px] font-mono cd-text-faint">{s.key}</span>
                    </div>
                    <p className="text-[10.5px] cd-text-faint mt-0.5 leading-relaxed">{s.desc}</p>
                    <p className="text-[11px] mt-1">
                      {s.rows == null ? (
                        <span className="text-[color:var(--cd-warning,#FFAE1F)]">미구축(테이블 없음)</span>
                      ) : (
                        <span className="cd-text-primary font-bold">{s.rows.toLocaleString("ko-KR")}행</span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── 우: 진단 상세 + 경고 ── */}
          <div className="flex flex-col gap-4 min-w-0 xl:overflow-y-auto">
            {/* 선택 엣지 상세 */}
            <div className="cd-card p-5 gap-3">
              <h3 className="font-bold cd-text text-[13.5px]">연결 품질 상세</h3>
              {!selected ? (
                <p className="text-[12px] cd-text-faint py-6 text-center">왼쪽 맵에서 연결선(또는 하단 칩)을 클릭하세요.</p>
              ) : (
                <>
                  <p className="text-[12px] cd-text">
                    <b>{selected.formName}</b>의 <b>{selected.fieldLabel}</b>
                    <span className="cd-text-faint font-mono text-[10.5px]"> ({selected.fieldKey})</span> → {selected.entityLabel}
                  </p>
                  {selected.totalDocs === 0 ? (
                    <p className="text-[12px] cd-text-faint">제출된 문서가 아직 없습니다.</p>
                  ) : (
                    <>
                      {/* 성공률 바 */}
                      <div className="h-3 rounded-full overflow-hidden flex border cd-border-c">
                        <div style={{ width: `${(selected.linkedDocs / selected.totalDocs) * 100}%`, background: "var(--cd-primary,#5D87FF)" }} />
                        <div style={{ width: `${(selected.manualDocs / selected.totalDocs) * 100}%`, background: "var(--cd-warning,#FFAE1F)" }} />
                        <div style={{ width: `${(selected.missingDocs / selected.totalDocs) * 100}%`, background: "var(--cd-danger,#FA896B)" }} />
                      </div>
                      <div className="flex items-center gap-3 text-[11px] cd-text-faint flex-wrap">
                        <span>총 {selected.totalDocs}건</span>
                        <span style={{ color: "var(--cd-primary,#5D87FF)" }}>연결 {selected.linkedDocs}</span>
                        <span style={{ color: "var(--cd-warning,#FFAE1F)" }}>직접 입력 {selected.manualDocs}</span>
                        <span style={{ color: "var(--cd-danger,#FA896B)" }}>미입력 {selected.missingDocs}</span>
                      </div>
                      <p className="text-[10.5px] cd-text-faint leading-relaxed">
                        직접 입력·미입력 문서는 이 엔티티 기준 집계(용역별 경비 등)에서 제외됩니다. 문서를 열어 값을 확인하세요.
                      </p>
                      {missingLoading && <p className="text-[11px] cd-text-faint">미연결 문서 조회 중...</p>}
                      {missingDocs && missingDocs.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[11.5px]">
                            <thead>
                              <tr className="text-left cd-text-faint text-[10.5px]">
                                <th className="py-1 pr-2 font-semibold">문서번호</th>
                                <th className="py-1 pr-2 font-semibold">기안자</th>
                                <th className="py-1 pr-2 font-semibold">상태</th>
                                <th className="py-1 font-semibold">사유</th>
                              </tr>
                            </thead>
                            <tbody>
                              {missingDocs.map((d) => (
                                <tr
                                  key={d.docId}
                                  className="border-t cd-border-c cd-row-hover cursor-pointer"
                                  onClick={() => setDetailDocId(d.docId)}
                                >
                                  <td className="py-1.5 pr-2 cd-text">{d.docNo ?? "(번호 없음)"}</td>
                                  <td className="py-1.5 pr-2 cd-text-faint">{d.drafterName ?? "-"}</td>
                                  <td className="py-1.5 pr-2 cd-text-faint">{d.status}</td>
                                  <td className="py-1.5">
                                    {d.manual ? (
                                      <span style={{ color: "var(--cd-warning,#FFAE1F)" }}>직접 입력</span>
                                    ) : (
                                      <span style={{ color: "var(--cd-danger,#FA896B)" }}>미입력</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            {/* 경고 패널 */}
            <div className="cd-card p-5 gap-3">
              <h3 className="font-bold cd-text text-[13.5px] flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" style={{ color: "var(--cd-warning,#FFAE1F)" }} /> 진단 경고
              </h3>
              {data.warnings.length === 0 ? (
                <p className="text-[12px] cd-text-faint">경고가 없습니다 — 태깅·채널 정책이 모두 정상입니다.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.warnings.map((w, i) => (
                    <li key={i} className="rounded-xl border border-dashed cd-border-c px-3 py-2 text-[11.5px] cd-text leading-relaxed">
                      <b>{w.formName}</b> — {w.message}
                      <a href="/approval/forms" className="ml-1.5 cd-text-primary underline underline-offset-2">
                        빌더에서 수정
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {detailDocId && <ApprovalDocModal docId={detailDocId} theme={theme} onClose={() => setDetailDocId(null)} />}
    </div>
  );
}
