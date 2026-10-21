"use client";

// 데이터 관계 맵(/approval/semantics, admin) — SW-P1.
// 양식(왼쪽)과 마스터 엔티티(오른쪽)를 엔티티 참조 필드로 잇는 이분 그래프 + 연결 품질 진단.
// 관계는 설정하는 것이 아니라 태그에서 자동 도출되며, 이 화면의 역할은 "확인과 진단":
// 연결 성공률·직접 입력·미연결 문서를 실측해 보여주고, 채널 정책 위반·미태깅을 경고한다.
// 설계: docs/semantic-analytics-wizard-blueprint.md §4-2·§4-4, docs/approval-master-linkage-audit-2026-10-21.md(L0 입력 참조 확장·결과 원장·L2 직접 입력 보정).

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Database, FileText, Link2, RefreshCw } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdHelp } from "@/components/cdash/CdHelp";
import { ApprovalDocModal } from "@/components/approval/ApprovalDocModal";
import { RelatedPickerModal } from "@/components/approval/RelatedPicker";
import { LINK_ENTITIES, LINK_ENTITY_LABEL } from "@/lib/approval/linkage";
import "@/components/cdash/cdash.css";

interface RefEdge {
  formId: string;
  formName: string;
  level: "doc" | "row" | "value";
  fieldKey: string;
  columnKey?: string;
  fieldLabel: string;
  entity: string;
  entityLabel: string;
  totalDocs: number;
  linkedDocs: number;
  manualDocs: number;
  missingDocs: number;
}
interface ResultEdge {
  formId: string;
  ledgerKey: string;
  recordedDocs: number | null;
  approvedDocs: number;
}
interface FormNode {
  formId: string;
  name: string;
  version: number;
  submittedDocs: number;
  approvedDocs: number;
  untaggedCount: number;
  taggedConcepts: string[];
  nonLinkReason: string | null;
  refLink: { refFormName: string; linkedDocs: number } | null;
}
interface Overview {
  forms: FormNode[];
  edges: RefEdge[];
  ledgers: { key: string; label: string; group: string; rows: number | null }[];
  resultEdges: ResultEdge[];
  derived: { key: string; label: string; desc: string; forms: string[] }[];
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
  manualText: string | null;
}

const LEDGER_GROUP_ORDER = ["hr", "finance", "contract", "work"] as const;
const LEDGER_GROUP_LABEL: Record<string, string> = {
  hr: "인사·근태 원장",
  finance: "재무·경비 원장",
  contract: "계약·영업 원장",
  work: "업무·자산 원장",
};
const LEVEL_LABEL: Record<RefEdge["level"], string> = { doc: "", row: "표", value: "값" };

/** 오른쪽 노드 — 입력 참조 마스터(entity) 또는 결과 원장(묶음 group / 개별 ledger) */
type RightNode =
  | { kind: "entity"; id: string; label: string }
  | { kind: "group"; id: string; label: string }
  | { kind: "ledger"; id: string; label: string; group: string; rows: number | null };

type Selection = { kind: "input"; edge: RefEdge } | { kind: "result"; edge: ResultEdge } | null;

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
const sameInput = (a: RefEdge, b: RefEdge) =>
  a.formId === b.formId && a.fieldKey === b.fieldKey && (a.columnKey ?? "") === (b.columnKey ?? "") && a.entity === b.entity;
const unit = (e: RefEdge) => (e.level === "row" ? "행" : "건");

export function ApprovalSemanticsBoard() {
  const { theme } = useCdashTheme();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection>(null);
  const [missingDocs, setMissingDocs] = useState<MissingDoc[] | null>(null);
  const [missingLoading, setMissingLoading] = useState(false);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);
  // 결과 원장은 기본 접힘(묶음 4개) — 펼치면 개별 원장 노드(D-6)
  const [ledgersOpen, setLedgersOpen] = useState(false);
  // 직접 입력 보정(L2) — 고른 직접 입력 값에 대해 계약·사업장 선택 모달
  const [relinkText, setRelinkText] = useState<string | null>(null);
  const [relinkMsg, setRelinkMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (): Promise<Overview | null> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/approval/semantics", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "진단 데이터를 불러오지 못했습니다.");
      setData(body);
      return body as Overview;
    } catch (err) {
      setError((err as Error).message);
      return null;
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
      const qs = new URLSearchParams({ formId: e.formId, fieldKey: e.fieldKey, entity: e.entity });
      if (e.columnKey) qs.set("columnKey", e.columnKey);
      const res = await fetch(`/api/approval/semantics?${qs.toString()}`, { cache: "no-store" });
      const body = await res.json();
      if (res.ok) setMissingDocs(body.docs ?? []);
    } finally {
      setMissingLoading(false);
    }
  };

  const selectEdge = (e: RefEdge) => {
    setSelected({ kind: "input", edge: e });
    setMissingDocs(null);
    setRelinkMsg(null);
    if (e.missingDocs + e.manualDocs > 0) openMissing(e);
  };
  const selectResult = (e: ResultEdge) => {
    setSelected({ kind: "result", edge: e });
    setMissingDocs(null);
    setRelinkMsg(null);
  };

  const relink = async (targetId: string) => {
    if (selected?.kind !== "input" || !relinkText) return;
    const e = selected.edge;
    setRelinkMsg(null);
    const res = await fetch("/api/approval/semantics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formId: e.formId, fieldKey: e.fieldKey, entity: e.entity, manualText: relinkText, targetId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setRelinkMsg({ ok: false, text: body?.error ?? "연결하지 못했습니다." });
      return;
    }
    const msg = { ok: true, text: `'${relinkText}' 문서 ${body.updated}건을 '${body.label}'에 연결했습니다.` };
    // 보정 후 같은 선의 최신 수치·목록으로 갱신
    const next = await load();
    const fresh = next?.edges.find((x) => sameInput(x, e));
    if (fresh) {
      setSelected({ kind: "input", edge: fresh });
      if (fresh.missingDocs + fresh.manualDocs > 0) openMissing(fresh);
      else setMissingDocs([]);
    }
    setRelinkMsg(msg);
  };

  const ledgerByKey = useMemo(() => new Map((data?.ledgers ?? []).map((l) => [l.key, l])), [data]);

  // 오른쪽 노드: 입력 참조 엔티티(엣지에 등장하는 것만, 고정 순서) + 결과 원장(묶음 또는 개별)
  const rightNodes = useMemo<RightNode[]>(() => {
    if (!data) return [];
    const present = new Set(data.edges.map((e) => e.entity));
    const nodes: RightNode[] = LINK_ENTITIES.filter((k) => present.has(k)).map((k) => ({
      kind: "entity" as const,
      id: k,
      label: LINK_ENTITY_LABEL[k],
    }));
    for (const g of LEDGER_GROUP_ORDER) {
      const members = data.ledgers.filter((l) => l.group === g);
      if (!members.length) continue;
      if (!ledgersOpen) nodes.push({ kind: "group", id: g, label: LEDGER_GROUP_LABEL[g] });
      else for (const l of members) nodes.push({ kind: "ledger", id: l.key, label: l.label, group: g, rows: l.rows });
    }
    return nodes;
  }, [data, ledgersOpen]);

  const rightIndexOfResult = (e: ResultEdge) => {
    const l = ledgerByKey.get(e.ledgerKey);
    if (!l) return -1;
    return rightNodes.findIndex((n) => (ledgersOpen ? n.kind === "ledger" && n.id === l.key : n.kind === "group" && n.id === l.group));
  };

  const forms = data?.forms ?? [];
  const graphH = Math.max(forms.length, rightNodes.length) * ROW_H + TOP_PAD * 2;
  const selForm = selected ? selected.edge.formId : null;

  // 직접 입력 값 묶음(문서 단위 계약·업체 슬롯) — 같은 값을 한 번에 연결한다
  const manualGroups = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of missingDocs ?? []) if (d.manual && d.manualText) m.set(d.manualText, (m.get(d.manualText) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [missingDocs]);
  const canRelink =
    selected?.kind === "input" && selected.edge.level === "doc" && (selected.edge.entity === "contract" || selected.edge.entity === "company");

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="데이터 관계 맵"
        meta={
          data
            ? `양식 ${forms.length} · 입력 참조 ${data.edges.length} · 결과 원장 ${data.resultEdges.length} · 경고 ${data.warnings.length}`
            : undefined
        }
        actions={
          <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5" onClick={() => void load()}>
            <RefreshCw className="w-3.5 h-3.5" /> 새로 고침
          </button>
        }
      />
      {error && <p className="text-sm cd-error-text">{error}</p>}
      {loading && !data ? (
        <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
      ) : data ? (
        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-4 overflow-y-auto xl:overflow-visible">
          {/* ── 좌: 관계 맵 + 시스템 소스 ── */}
          <div className="flex flex-col gap-4 min-w-0 xl:overflow-y-auto">
            <div className="cd-card p-5 gap-3">
              <h3 className="font-bold cd-text text-[13.5px] flex items-center gap-1.5">
                <Link2 className="w-4 h-4 cd-text-primary" /> 양식 ↔ 마스터 데이터 연결<CdHelp topic="approval-ops.semantics-map" />
                <button
                  type="button"
                  className="cd-btn ml-auto rounded-lg border cd-border-c px-2 py-1 text-[11px] font-normal flex items-center gap-1"
                  onClick={() => setLedgersOpen((v) => !v)}
                  aria-expanded={ledgersOpen}
                >
                  {ledgersOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  {ledgersOpen ? "결과 원장 접기" : "결과 원장 펼치기"}
                </button>
              </h3>
              <p className="text-[11px] cd-text-faint -mt-1">
                실선은 양식이 마스터를 가리키는 입력 참조(검색 항목·표 열·전용 화면 값), 점선은 결재 후 문서 번호를 기록하는 원장입니다. 선을 클릭하면 상세를 확인할 수 있습니다.
              </p>
              <div className="grid grid-cols-[1fr_120px_1fr] items-start" style={{ minHeight: graphH }}>
                {/* 양식 노드 */}
                <div className="flex flex-col" style={{ paddingTop: TOP_PAD }}>
                  {forms.map((f) => (
                    <div key={f.formId} style={{ height: ROW_H }} className="flex items-start">
                      <div
                        className={`w-full rounded-xl border px-3 py-2 ${selForm === f.formId ? "cd-glass-active" : "cd-border-c"}`}
                        style={{ height: NODE_H, background: selForm === f.formId ? undefined : "var(--cd-card-solid)" }}
                        title={f.nonLinkReason ?? undefined}
                      >
                        <span className="block text-[12px] font-bold cd-text truncate">
                          <FileText className="w-3 h-3 inline mr-1 cd-text-faint" />
                          {f.name}
                        </span>
                        <span className="block text-[10.5px] cd-text-faint truncate">
                          제출 {f.submittedDocs}건 · v{f.version}
                          {f.nonLinkReason && <span> · 연계 대상 아님</span>}
                          {f.refLink && (
                            <span>
                              {" "}· 선행 연결 {f.refLink.linkedDocs}/{f.submittedDocs}
                            </span>
                          )}
                          {f.untaggedCount > 0 && <span className="text-[color:var(--cd-warning,#FFAE1F)]"> · 미태깅 {f.untaggedCount}</span>}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {/* 연결선(SVG) — 행 index 기반 좌표. 입력 참조 = 실선(연결률 색), 결과 원장 = 점선 */}
                <svg width="100%" height={graphH} viewBox={`0 0 120 ${graphH}`} preserveAspectRatio="none" className="block">
                  {data.resultEdges.map((e, i) => {
                    const fi = forms.findIndex((f) => f.formId === e.formId);
                    const ri = rightIndexOfResult(e);
                    if (fi < 0 || ri < 0) return null;
                    const y1 = TOP_PAD + fi * ROW_H + NODE_H / 2;
                    const y2 = TOP_PAD + ri * ROW_H + NODE_H / 2;
                    const on = selected?.kind === "result" && selected.edge.formId === e.formId && selected.edge.ledgerKey === e.ledgerKey;
                    return (
                      <path
                        key={`r${i}`}
                        d={`M 0 ${y1} C 60 ${y1}, 60 ${y2}, 120 ${y2}`}
                        fill="none"
                        stroke={e.recordedDocs ? "var(--cd-text-faint, #7C8FAC)" : "var(--cd-border, #DFE5EF)"}
                        strokeWidth={on ? 3 : 1.5}
                        strokeDasharray="4 3"
                        opacity={selected && !on ? 0.2 : 0.8}
                        style={{ cursor: "pointer" }}
                        onClick={() => selectResult(e)}
                      />
                    );
                  })}
                  {data.edges.map((e, i) => {
                    const fi = forms.findIndex((f) => f.formId === e.formId);
                    const ei = rightNodes.findIndex((n) => n.kind === "entity" && n.id === e.entity);
                    if (fi < 0 || ei < 0) return null;
                    const y1 = TOP_PAD + fi * ROW_H + NODE_H / 2;
                    const y2 = TOP_PAD + ei * ROW_H + NODE_H / 2;
                    const on = selected?.kind === "input" && sameInput(selected.edge, e);
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
                {/* 오른쪽 노드 — 마스터(입력 참조) + 결과 원장 */}
                <div className="flex flex-col" style={{ paddingTop: TOP_PAD }}>
                  {rightNodes.map((n) => {
                    const active =
                      (n.kind === "entity" && selected?.kind === "input" && selected.edge.entity === n.id) ||
                      (n.kind !== "entity" &&
                        selected?.kind === "result" &&
                        (n.kind === "ledger" ? selected.edge.ledgerKey === n.id : ledgerByKey.get(selected.edge.ledgerKey)?.group === n.id));
                    const sub =
                      n.kind === "entity"
                        ? `연결 양식 ${new Set(data.edges.filter((e) => e.entity === n.id).map((e) => e.formId)).size}개`
                        : n.kind === "group"
                          ? `원장 ${data.ledgers.filter((l) => l.group === n.id).length}종 · 연결 양식 ${
                              new Set(data.resultEdges.filter((e) => ledgerByKey.get(e.ledgerKey)?.group === n.id).map((e) => e.formId)).size
                            }개`
                          : n.rows == null
                            ? "미구축"
                            : `${n.rows.toLocaleString("ko-KR")}행`;
                    return (
                      <div key={`${n.kind}:${n.id}`} style={{ height: ROW_H }} className="flex items-start">
                        <div
                          className={`w-full rounded-xl border px-3 py-2 ${active ? "cd-glass-active" : "cd-border-c"} ${n.kind === "entity" ? "" : "border-dashed"}`}
                          style={{ height: NODE_H, background: active ? undefined : "var(--cd-card-solid)" }}
                        >
                          <span className="block text-[12px] font-bold cd-text truncate">
                            <Database className="w-3 h-3 inline mr-1 cd-text-faint" />
                            {n.label}
                          </span>
                          <span className="block text-[10.5px] cd-text-faint truncate">{sub}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* 엣지 리스트(선 클릭이 어려운 환경 대비) */}
              <div className="flex flex-wrap gap-1.5 pt-1 border-t cd-border-c">
                {data.edges.map((e, i) => {
                  const rate = edgeRate(e);
                  const on = selected?.kind === "input" && sameInput(selected.edge, e);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => selectEdge(e)}
                      data-active={!!on}
                      aria-pressed={!!on}
                      className={`cd-choice rounded-lg border px-2 py-1 text-[10.5px] ${on ? "cd-glass-active" : "cd-border-c cd-text-faint cd-row-hover"}`}
                    >
                      {e.formName} → {e.entityLabel}
                      {LEVEL_LABEL[e.level] && <span className="ml-0.5">({LEVEL_LABEL[e.level]})</span>}
                      <b className="ml-1" style={{ color: rateColor(rate) }}>
                        {rate == null ? "문서 없음" : `${Math.round(rate * 100)}%`}
                      </b>
                    </button>
                  );
                })}
                {data.edges.length === 0 && <span className="text-[11px] cd-text-faint">엔티티 참조 항목을 가진 양식이 없습니다.</span>}
              </div>
              {data.derived.length > 0 && (
                <p className="text-[10.5px] cd-text-faint leading-relaxed">
                  기록 없이 승인 문서를 읽어 가는 경로:{" "}
                  {data.derived
                    .map((d) => `${d.label}(${d.forms.map((id) => forms.find((f) => f.formId === id)?.name ?? id).join("·")})`)
                    .join(" · ")}
                </p>
              )}
            </div>

            {/* 시스템 소스 카탈로그 */}
            <div className="cd-card p-5 gap-3">
              <h3 className="font-bold cd-text text-[13.5px] flex items-center gap-1.5">
                <Database className="w-4 h-4 cd-text-primary" /> 시스템 데이터 소스
              </h3>
              <p className="text-[11px] cd-text-faint -mt-1">결재 문서 밖의 분석 소스 — 지표 마법사에서 결재 지표와 계약·직원·업체·부서 기준으로 결합합니다.</p>
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
              ) : selected.kind === "result" ? (
                <ResultDetail edge={selected.edge} ledger={ledgerByKey.get(selected.edge.ledgerKey)} formName={forms.find((f) => f.formId === selected.edge.formId)?.name ?? selected.edge.formId} />
              ) : (
                <>
                  <p className="text-[12px] cd-text">
                    <b>{selected.edge.formName}</b>의 <b>{selected.edge.fieldLabel}</b>
                    <span className="cd-text-faint font-mono text-[10.5px]">
                      {" "}({selected.edge.fieldKey}
                      {selected.edge.columnKey ? `.${selected.edge.columnKey}` : ""})
                    </span>{" "}
                    → {selected.edge.entityLabel}
                    {selected.edge.level === "row" && <span className="cd-text-faint"> · 표 행 단위</span>}
                  </p>
                  {selected.edge.totalDocs === 0 ? (
                    <p className="text-[12px] cd-text-faint">제출된 문서(또는 값이 있는 행)가 아직 없습니다.</p>
                  ) : (
                    <>
                      {/* 성공률 바 */}
                      <div className="h-3 rounded-full overflow-hidden flex border cd-border-c">
                        <div style={{ width: `${(selected.edge.linkedDocs / selected.edge.totalDocs) * 100}%`, background: "var(--cd-primary,#5D87FF)" }} />
                        <div style={{ width: `${(selected.edge.manualDocs / selected.edge.totalDocs) * 100}%`, background: "var(--cd-warning,#FFAE1F)" }} />
                        <div style={{ width: `${(selected.edge.missingDocs / selected.edge.totalDocs) * 100}%`, background: "var(--cd-danger,#FA896B)" }} />
                      </div>
                      <div className="flex items-center gap-3 text-[11px] cd-text-faint flex-wrap">
                        <span>
                          총 {selected.edge.totalDocs}
                          {unit(selected.edge)}
                        </span>
                        <span style={{ color: "var(--cd-primary,#5D87FF)" }}>연결 {selected.edge.linkedDocs}</span>
                        <span style={{ color: "var(--cd-warning,#FFAE1F)" }}>직접 입력 {selected.edge.manualDocs}</span>
                        <span style={{ color: "var(--cd-danger,#FA896B)" }}>미입력 {selected.edge.missingDocs}</span>
                      </div>
                      <p className="text-[10.5px] cd-text-faint leading-relaxed">
                        직접 입력·미입력 문서는 이 엔티티 기준 집계(용역별 경비 등)에서 제외됩니다. 문서를 열어 값을 확인하세요.
                      </p>
                      {/* 직접 입력 보정(L2) — 같은 값의 문서를 한 번에 계약·사업장에 연결 */}
                      {canRelink && (manualGroups.length > 0 || relinkMsg) && (
                        <div className="rounded-xl border border-dashed cd-border-c p-3 flex flex-col gap-2">
                          <span className="text-[11.5px] font-bold cd-text">직접 입력 값 연결</span>
                          <span className="text-[10.5px] cd-text-faint -mt-1">
                            같은 값으로 입력된 문서를 한 번에 {selected.edge.entityLabel}에 연결합니다. 원래 입력값은 문서에 보존됩니다.
                          </span>
                          <ul className="flex flex-col gap-1">
                            {manualGroups.map(([text, n]) => (
                              <li key={text} className="flex items-center gap-2 text-[11.5px]">
                                <span className="cd-text truncate flex-1 min-w-0" title={text}>
                                  {text}
                                </span>
                                <span className="cd-text-faint shrink-0">{n}건</span>
                                <button
                                  type="button"
                                  className="cd-btn cd-action rounded-lg border cd-border-c px-2 py-0.5 text-[11px] shrink-0"
                                  onClick={() => {
                                    setRelinkMsg(null);
                                    setRelinkText(text);
                                  }}
                                >
                                  연결
                                </button>
                              </li>
                            ))}
                          </ul>
                          {relinkMsg && <p className={`text-[11px] ${relinkMsg.ok ? "cd-text-primary" : "cd-error-text"}`}>{relinkMsg.text}</p>}
                        </div>
                      )}
                      {missingLoading && <p className="text-[11px] cd-text-faint">미연결 문서 조회 중...</p>}
                      {missingDocs && missingDocs.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[11.5px]">
                            <thead className="cd-table-head">
                              <tr className="text-left cd-text-faint text-[10.5px]">
                                <th className="py-1 pr-2 font-semibold">문서번호</th>
                                <th className="py-1 pr-2 font-semibold">기안자</th>
                                <th className="py-1 pr-2 font-semibold">상태</th>
                                <th className="py-1 font-semibold">사유</th>
                              </tr>
                            </thead>
                            <tbody>
                              {missingDocs.map((d) => (
                                <tr key={d.docId} className="border-t cd-border-c cd-row-hover cursor-pointer" onClick={() => setDetailDocId(d.docId)}>
                                  <td className="py-1.5 pr-2 cd-text">{d.docNo ?? "(번호 없음)"}</td>
                                  <td className="py-1.5 pr-2 cd-text-faint">{d.drafterName ?? "-"}</td>
                                  <td className="py-1.5 pr-2 cd-text-faint">{d.status}</td>
                                  <td className="py-1.5">
                                    {d.manual ? (
                                      <span style={{ color: "var(--cd-warning,#FFAE1F)" }} title={d.manualText ?? undefined}>
                                        직접 입력
                                      </span>
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
                <p className="text-[12px] cd-text-faint">경고가 없습니다 — 태깅·채널 정책·연결이 모두 정상입니다.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.warnings.map((w, i) => (
                    <li key={i} className="rounded-xl border border-dashed cd-border-c px-3 py-2 text-[11.5px] cd-text leading-relaxed">
                      <b>{w.formName}</b> — {w.message}
                      {w.kind !== "manual_ratio" && (
                        <a href="/approval/forms" className="ml-1.5 cd-text-primary underline underline-offset-2">
                          빌더에서 수정
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {detailDocId && <ApprovalDocModal docId={detailDocId} theme={theme} onClose={() => setDetailDocId(null)} />}
      <RelatedPickerModal
        open={relinkText != null}
        onClose={() => setRelinkText(null)}
        title={selected?.kind === "input" && selected.edge.entity === "company" ? "연결할 사업장 선택" : "연결할 계약(용역) 선택"}
        current={relinkText ?? undefined}
        onPick={(ref) => {
          if (!ref || selected?.kind !== "input") return;
          const id = selected.edge.entity === "company" ? ref.facilityId : ref.contractId;
          if (!id) {
            setRelinkMsg({
              ok: false,
              text:
                selected.edge.entity === "company"
                  ? "사업장이 없는 항목입니다. 사업장을 고르세요."
                  : "계약(용역)을 고르세요 — 사업장만으로는 계약에 연결할 수 없습니다.",
            });
            return;
          }
          void relink(id);
        }}
      />
    </div>
  );
}

/** 결과 원장 선 상세 — 기록 건수와 원장의 의미 */
function ResultDetail({
  edge,
  ledger,
  formName,
}: {
  edge: ResultEdge;
  ledger: { key: string; label: string } | undefined;
  formName: string;
}) {
  return (
    <>
      <p className="text-[12px] cd-text">
        <b>{formName}</b> → <b>{ledger?.label ?? edge.ledgerKey}</b>
        <span className="cd-text-faint font-mono text-[10.5px]"> ({edge.ledgerKey})</span>
      </p>
      {edge.recordedDocs == null ? (
        <p className="text-[12px] text-[color:var(--cd-warning,#FFAE1F)]">원장(또는 문서 번호 칸)이 아직 구축되지 않았습니다.</p>
      ) : (
        <p className="text-[12px] cd-text">
          기록된 문서 <b>{edge.recordedDocs}건</b>
          <span className="cd-text-faint"> / 승인 문서 {edge.approvedDocs}건</span>
        </p>
      )}
      <p className="text-[10.5px] cd-text-faint leading-relaxed">
        결재가 끝나면(일부는 상신할 때) 이 원장에 문서 번호가 남아 원장에서 원 문서를 찾아갈 수 있습니다. 지출처럼 문서마다 기록이 생기지 않는 원장도 있어 비율은 참고용입니다.
      </p>
    </>
  );
}
