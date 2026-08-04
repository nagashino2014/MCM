"use client";

// AI 브리핑 리포트 뷰 (briefing-report.html 핸드오프 재현, cdash 토큰) —
// KPI 4칸 · 핵심 동향 콜아웃 · 투자계획 상세(회사 카드) · 영업 시사점 카드 · 출처 신호(본문 인용 하이라이트).
// 인용 칩 [n]: 호버 시 출처 요약 팝오버, 클릭 시 신호 상세 모달. 섹션은 접기/펼치기.
// report(구조화 JSON)가 없는 구버전 브리핑은 마크다운 폴백으로 렌더한다.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, RefreshCw, Send, Share2, Sparkles, X } from "lucide-react";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { OrganizationEmployeeRow, OrganizationSnapshot } from "@/components/admin/users/types";
import { filterAssigneeTree } from "@/lib/sales/org-tree";
import { filenameFromDisposition } from "@/lib/client-download";
import type { Briefing, BriefingSource } from "./intel-shared";
import { SOURCE_LABEL } from "./intel-shared";

// 연한 파랑 틴트(핵심 동향 콜아웃 기준색) — KPI·회사 카드의 보조 표면과 함께 컴포넌트 공통 톤.
// color-mix 로 라이트/다크 토큰에 모두 적응한다.
const TINT_BG = "color-mix(in srgb, var(--cd-primary-soft) 55%, var(--cd-card))";
const SOFT_SURFACE = "color-mix(in srgb, var(--cd-surface) 45%, var(--cd-card))";

// ── 인용 팝오버 상태(리포트 단위 공유) ──

interface PopoverState {
  x: number;
  y: number;
  n: number;
  source: BriefingSource;
}

interface CiteContext {
  sources: BriefingSource[];
  onOpenSignal: (signalId: string) => void;
  setPopover: (p: PopoverState | null) => void;
}

function CiteChip({ n, ctx, muted }: { n: number; ctx: CiteContext; muted?: boolean }) {
  const src = ctx.sources[n - 1];
  return (
    <button
      className="inline-flex items-center justify-center align-baseline mx-0.5 rounded font-bold"
      style={{
        minWidth: 17, height: 17, padding: "0 5px", fontSize: 11, verticalAlign: "1px",
        background: muted ? "var(--cd-surface)" : "var(--cd-primary-soft)",
        color: muted ? "var(--cd-muted)" : "var(--cd-primary)",
        cursor: src ? "pointer" : "default",
      }}
      title={src ? "출처 신호 보기" : undefined}
      onClick={() => src && ctx.onOpenSignal(src.signalId)}
      onMouseEnter={(e) => {
        if (!src) return;
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        ctx.setPopover({ x: r.left + r.width / 2, y: r.top, n, source: src });
      }}
      onMouseLeave={() => ctx.setPopover(null)}
    >
      {n}
    </button>
  );
}

/** **굵게** / *약조* / [n] 인용을 처리하는 인라인 렌더러. */
function InlineMd({ text, ctx, muted }: { text: string; ctx: CiteContext; muted?: boolean }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[\d+\])/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i} className="font-bold cd-text">{p.slice(2, -2)}</strong>;
        if (/^\*[^*]+\*$/.test(p)) return <em key={i} className="cd-text-muted not-italic">{p.slice(1, -1)}</em>;
        const m = p.match(/^\[(\d+)\]$/);
        if (m) return <CiteChip key={i} n={Number(m[1])} ctx={ctx} muted={muted} />;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

// ── 마크다운 폴백(구버전 브리핑) ──

function BriefingMarkdown({ md, ctx }: { md: string; ctx: CiteContext }) {
  const blocks = useMemo(() => {
    const lines = md.split(/\r?\n/);
    const out: Array<{ kind: "h2" | "h3" | "p"; text: string } | { kind: "ul"; items: string[] }> = [];
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      if (line.startsWith("### ")) { out.push({ kind: "h3", text: line.slice(4) }); continue; }
      if (line.startsWith("## ")) { out.push({ kind: "h2", text: line.slice(3) }); continue; }
      const li = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
      if (li) {
        const prev = out[out.length - 1];
        if (prev && prev.kind === "ul") prev.items.push(li[1]);
        else out.push({ kind: "ul", items: [li[1]] });
        continue;
      }
      out.push({ kind: "p", text: line });
    }
    return out;
  }, [md]);

  return (
    <div className="flex flex-col gap-1.5 px-1">
      {blocks.map((b, i) => {
        if (b.kind === "h2") return <h4 key={i} className="cd-text text-[0.95rem] font-extrabold mt-3 first:mt-0">{b.text}</h4>;
        if (b.kind === "h3") return <h5 key={i} className="cd-text text-sm font-bold mt-2"><InlineMd text={b.text} ctx={ctx} /></h5>;
        if (b.kind === "ul")
          return (
            <ul key={i} className="flex flex-col gap-1 pl-1">
              {b.items.map((it, j) => (
                <li key={j} className="cd-text text-sm leading-relaxed flex gap-2">
                  <span className="cd-text-faint shrink-0 mt-0.5">•</span>
                  <span className="min-w-0"><InlineMd text={it} ctx={ctx} /></span>
                </li>
              ))}
            </ul>
          );
        return <p key={i} className="cd-text text-sm leading-relaxed"><InlineMd text={b.text} ctx={ctx} /></p>;
      })}
    </div>
  );
}

// ── 접이식 섹션 ──

function Section({
  title,
  chips,
  defaultCollapsed,
  children,
}: {
  title: string;
  chips?: React.ReactNode;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(!!defaultCollapsed);
  return (
    <section className="flex flex-col gap-3">
      <button className="flex items-center gap-2.5 w-full text-left" onClick={() => setCollapsed((v) => !v)}>
        <span className="cd-text text-[0.95rem] font-extrabold whitespace-nowrap">{title}</span>
        {chips}
        <span className="flex-1 h-px" style={{ background: "var(--cd-border)" }} />
        <span className="cd-text-faint text-xs whitespace-nowrap inline-flex items-center gap-1">
          {collapsed ? <>펼치기 <ChevronDown className="w-3.5 h-3.5" /></> : <>접기 <ChevronUp className="w-3.5 h-3.5" /></>}
        </span>
      </button>
      {!collapsed && children}
    </section>
  );
}

// ── 시사점 배지 스타일 ──

function insightBadgeStyle(badge: string): React.CSSProperties {
  if (badge.includes("우선")) return { background: "var(--cd-primary)", color: "#fff" };
  if (badge.includes("차순위")) return { background: "var(--cd-primary-soft)", color: "var(--cd-primary)" };
  if (badge.includes("타이밍"))
    return { background: "var(--cd-primary-soft)", color: "var(--cd-primary)", border: "1px solid var(--cd-primary)" };
  return { background: "var(--cd-surface)", color: "var(--cd-muted)" };
}

// ── 메인 리포트 뷰 ──

const SOURCE_PREVIEW_COUNT = 4;

export function BriefingReportView({
  briefing,
  onClose,
  onOpenSignal,
  theme = "light",
  canEdit = false,
  onBriefingUpdate,
}: {
  briefing: Briefing;
  onClose: () => void;
  onOpenSignal: (signalId: string) => void;
  /** 포털 모달(cdash-vars) 테마 — RagBoard 의 useCdashTheme 값 */
  theme?: string;
  canEdit?: boolean;
  /** 추가 분석(refine)으로 브리핑이 갱신되면 호출 — 현재 표시 브리핑·이력 갱신용 */
  onBriefingUpdate?: (briefing: Briefing) => void;
}) {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [showAllSources, setShowAllSources] = useState(false);
  const report = briefing.report;

  // ── PDF 다운로드 ──
  const [pdfBusy, setPdfBusy] = useState(false);
  const downloadPdf = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      const res = await fetch(`/api/sales/rag/briefings/${briefing.briefingId}/export`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = (briefing.createdAt || "").slice(0, 10).replace(/-/g, "");
      a.download = filenameFromDisposition(res, `AI브리핑_${stamp}.pdf`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* 다운로드 실패는 조용히 — 재시도 가능 */
    } finally {
      setPdfBusy(false);
    }
  };

  // ── 공유 모달 ──
  const [shareOpen, setShareOpen] = useState(false);

  // ── 추가 분석(refine) — 버튼 클릭 시 오른쪽에 입력창 확장 ──
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineText, setRefineText] = useState("");
  const [refineBusy, setRefineBusy] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const runRefine = async () => {
    const instruction = refineText.trim();
    if (!instruction || refineBusy) return;
    setRefineBusy(true);
    setRefineError(null);
    try {
      const res = await fetch(`/api/sales/rag/briefings/${briefing.briefingId}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setRefineText("");
      setRefineOpen(false);
      onBriefingUpdate?.(data.briefing as Briefing);
    } catch (e) {
      setRefineError((e as Error).message);
    } finally {
      setRefineBusy(false);
    }
  };

  const ctx: CiteContext = { sources: briefing.sources, onOpenSignal, setPopover };

  // 본문에서 실제 인용된 신호 번호 — 출처 카드 하이라이트용.
  // etcNote 는 '다루지 않은 나머지' 나열이므로 제외(포함하면 사실상 전건이 하이라이트됨).
  const citedSet = useMemo(() => {
    const texts: string[] = [];
    if (report) {
      report.kpis.forEach((k) => k.sub && texts.push(k.sub));
      texts.push(...report.trends);
      report.companies.forEach((c) => {
        texts.push(c.desc);
        if (c.note) texts.push(c.note.text);
      });
      report.insights.forEach((i) => texts.push(i.text));
    } else if (briefing.answerMd) {
      texts.push(briefing.answerMd);
    }
    const set = new Set<number>();
    for (const t of texts) for (const m of t.matchAll(/\[(\d+)\]/g)) set.add(Number(m[1]));
    return set;
  }, [report, briefing.answerMd]);

  const visibleSources = showAllSources ? briefing.sources : briefing.sources.slice(0, SOURCE_PREVIEW_COUNT);

  return (
    <article className="cd-card-bg rounded-2xl border cd-border-c overflow-hidden">
      {/* 출처 카드: 기본 흰 배경, 마우스오버 시에만 틴트(인라인 style 은 hover 를 못 덮으므로 클래스로) */}
      <style>{`
        .rag-src-card { background: var(--cd-card); transition: background 0.12s ease; }
        .rag-src-card:hover { background: ${TINT_BG}; }
      `}</style>
      {/* 헤더 */}
      <div className="flex items-start gap-3 px-5 py-4 border-b cd-border-c">
        <span
          className="inline-flex items-center justify-center shrink-0 rounded-lg font-extrabold"
          style={{ width: 30, height: 30, background: "var(--cd-primary)", color: "#fff", fontSize: 14, marginTop: 1 }}
        >
          Q
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="cd-text text-base font-extrabold break-words leading-snug">{briefing.question}</h3>
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            <span className="cd-pill cd-pill-idle">{briefing.createdAt?.slice(0, 16).replace("T", " ")}</span>
            <span className="cd-pill cd-pill-idle">출처 {briefing.sources.length}건</span>
            {briefing.model && <span className="cd-pill cd-pill-idle">{briefing.model}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          <button
            type="button"
            className="flex items-center justify-center disabled:opacity-40"
            style={{ width: 28, height: 28 }}
            title="브리핑을 PDF로 다운로드"
            disabled={pdfBusy}
            onClick={downloadPdf}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/pdfico.png" alt="PDF 다운로드" className="w-full h-full object-contain" />
          </button>
          {canEdit && (
            <button className="cd-btn cd-btn-soft cd-btn-sm" title="브리핑 공유" onClick={() => setShareOpen(true)}>
              <Share2 className="w-3.5 h-3.5" /> 공유
            </button>
          )}
          {canEdit && (
            <button
              className="cd-btn cd-btn-soft cd-btn-sm"
              title="브리핑 내용을 추가 질문으로 보강합니다"
              onClick={() => setRefineOpen((v) => !v)}
            >
              <Sparkles className="w-3.5 h-3.5" /> 추가 분석
            </button>
          )}
          {refineOpen && (
            <>
              <input
                className="cd-input"
                style={{ width: 300, maxWidth: "50vw" }}
                placeholder="심화 분석·추가 정보가 필요한 내용을 입력하세요"
                value={refineText}
                autoFocus
                disabled={refineBusy}
                onChange={(e) => setRefineText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); runRefine(); }
                }}
              />
              <button
                className="cd-btn cd-btn-primary cd-btn-sm"
                disabled={refineBusy || !refineText.trim()}
                onClick={runRefine}
              >
                {refineBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {refineBusy ? "분석 중…" : "요청"}
              </button>
            </>
          )}
          <button className="cd-btn cd-btn-ghost cd-btn-sm" title="결과 닫기" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      {refineBusy && (
        <div className="mx-5 mt-3 cd-tint-primary rounded-xl px-4 py-3 text-sm cd-text">
          추가 분석으로 브리핑을 보강하는 중입니다… (최대 1~2분)
        </div>
      )}
      {refineError && (
        <div className="mx-5 mt-3 cd-error-bg cd-error-text rounded-xl px-4 py-3 text-sm">{refineError}</div>
      )}

      <div className="px-5 py-5 flex flex-col gap-6">
        {report ? (
          <>
            {/* KPI */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              {report.kpis.slice(0, 4).map((k, i) => (
                <div key={i} className="rounded-xl border cd-border-c px-4 py-3.5 flex flex-col gap-1.5" style={{ background: SOFT_SURFACE }}>
                  <span className="cd-text-faint text-[11.5px] font-bold tracking-wide">{k.label}</span>
                  <span className={`text-xl font-extrabold ${k.value === "미공개" ? "cd-text-muted" : "cd-text"}`}>{k.value}</span>
                  {k.sub && (() => {
                    // 요약문과 인용 칩을 행 분리 — 요약문 위, 신호 태그 아래
                    const cites = [...k.sub.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
                    const text = k.sub.replace(/\s*\[\d+\]/g, "").replace(/\s{2,}/g, " ").trim();
                    return (
                      <>
                        {text && (
                          <span
                            className="cd-text-muted text-xs leading-relaxed"
                            style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
                          >
                            <InlineMd text={text} ctx={ctx} />
                          </span>
                        )}
                        {cites.length > 0 && (
                          <span className="flex items-center gap-0.5 flex-wrap">
                            {cites.map((n, j) => <CiteChip key={j} n={n} ctx={ctx} />)}
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>

            {/* 핵심 동향 */}
            {report.trends.length > 0 && (
              <div className="rounded-xl px-5 py-4 flex flex-col gap-2.5" style={{ background: TINT_BG, border: "1px solid var(--cd-primary-soft)" }}>
                <span className="inline-flex items-center gap-2 text-xs font-extrabold tracking-wider" style={{ color: "var(--cd-primary)" }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--cd-primary)" }} />
                  핵심 동향
                </span>
                {report.trends.map((t, i) => (
                  <p key={i} className="cd-text text-[13.5px] leading-relaxed"><InlineMd text={t} ctx={ctx} /></p>
                ))}
              </div>
            )}

            {/* 투자계획 상세 */}
            {(report.companies.length > 0 || report.etcNote) && (
              <Section title="투자계획 상세">
                <div className="flex flex-col gap-3">
                  {report.companies.length > 0 && (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                      {report.companies.map((c, i) => (
                        <div key={i} className="rounded-xl border cd-border-c px-5 py-4 flex flex-col gap-2.5" style={{ background: SOFT_SURFACE }}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="cd-text text-[15px] font-extrabold">{c.name}</span>
                            {c.region && <span className="cd-pill cd-pill-idle">{c.region}</span>}
                            {c.status && <span className="cd-pill cd-pill-success">{c.status}</span>}
                          </div>
                          {c.project && <p className="text-[13px] font-bold" style={{ color: "var(--cd-primary)" }}>{c.project}</p>}
                          {/* 상세 설명 — 문장 단위 줄바꿈으로 가독성 확보 */}
                          <div className="flex flex-col gap-1">
                            {c.desc.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean).map((sentence, j) => (
                              <p key={j} className="cd-text text-[13px] leading-relaxed"><InlineMd text={sentence} ctx={ctx} /></p>
                            ))}
                          </div>
                          {c.facts.length > 0 && (
                            <div className="flex gap-12 pt-2.5" style={{ borderTop: "1px dashed var(--cd-border)" }}>
                              {c.facts.map((f, j) => (
                                <div key={j} className="flex flex-col gap-0.5">
                                  <span className="cd-text-faint text-[10.5px] font-bold">{f.label}</span>
                                  <span className="cd-text text-[13px] font-bold">{f.value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {c.note && (
                            <p
                              className="text-xs rounded-lg px-3 py-2 leading-relaxed"
                              style={
                                c.note.kind === "리스크"
                                  ? { background: "var(--cd-error-soft)", color: "var(--cd-error)" }
                                  : { background: "var(--cd-warning-soft)", color: "var(--cd-warning)" }
                              }
                            >
                              <b>{c.note.kind}</b> · {c.note.text}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {report.etcNote && (() => {
                    // 인용 칩이 문장 곳곳에 흩어지지 않도록 — 텍스트와 분리해 우측에 모아 정렬
                    const cites = [...report.etcNote.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
                    const text = report.etcNote.replace(/\s*\[\d+\]/g, "").replace(/\s{2,}/g, " ").trim();
                    return (
                      <div className="rounded-xl px-4 py-3 flex items-center gap-2 flex-wrap" style={{ background: SOFT_SURFACE }}>
                        <span className="cd-text-muted text-[12.5px] leading-relaxed flex-1 min-w-[200px]">{text}</span>
                        {cites.length > 0 && (
                          <span className="flex items-center gap-0.5 flex-wrap shrink-0">
                            {cites.map((n, j) => <CiteChip key={j} n={n} ctx={ctx} muted />)}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </Section>
            )}

            {/* 영업 시사점 */}
            {report.insights.length > 0 && (
              <Section title="영업 시사점">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5">
                  {report.insights.map((ins, i) => (
                    <div
                      key={i}
                      className="rounded-xl border cd-border-c px-4 py-3.5 flex flex-col gap-2"
                      style={ins.badge.includes("우선") ? { borderColor: "var(--cd-primary-soft)", background: TINT_BG } : undefined}
                    >
                      <span
                        className="self-start inline-flex items-center rounded-md px-2 font-extrabold"
                        style={{ height: 21, fontSize: 10.5, ...insightBadgeStyle(ins.badge) }}
                      >
                        {ins.badge}
                      </span>
                      <p className="cd-text text-[12.5px] leading-relaxed"><InlineMd text={ins.text} ctx={ctx} /></p>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </>
        ) : (
          // 구조화 리포트가 없는 구버전 브리핑 — 마크다운 폴백
          briefing.answerMd && <BriefingMarkdown md={briefing.answerMd} ctx={ctx} />
        )}

        {/* 출처 신호 */}
        {briefing.sources.length > 0 && (
          <Section
            title="출처 신호"
            chips={
              <>
                <span className="cd-pill cd-pill-idle">{briefing.sources.length}건</span>
                {citedSet.size > 0 && <span className="cd-pill cd-pill-info">본문 인용 {citedSet.size}건</span>}
              </>
            }
          >
            <div className="flex flex-col gap-2.5">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
                {visibleSources.map((src, i) => {
                  const n = i + 1;
                  const cited = citedSet.has(n);
                  return (
                    <button
                      key={src.signalId}
                      className="rag-src-card rounded-xl border text-left px-3.5 py-3 flex flex-col gap-1.5 min-w-0"
                      style={cited ? { borderColor: "var(--cd-primary)", background: TINT_BG } : { borderColor: "var(--cd-border)" }}
                      onClick={() => onOpenSignal(src.signalId)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="inline-flex items-center justify-center rounded-md font-bold shrink-0"
                          style={{
                            width: 20, height: 20, fontSize: 11,
                            background: cited ? "var(--cd-primary)" : "var(--cd-surface)",
                            color: cited ? "#fff" : "var(--cd-muted)",
                          }}
                        >
                          {n}
                        </span>
                        <span className="cd-text-faint text-[10px] font-extrabold tracking-wider shrink-0">
                          {(SOURCE_LABEL[src.source] ?? src.source).toUpperCase()}
                        </span>
                        <span className="cd-text text-[13px] font-bold truncate">{src.companyName ?? "회사 미상"}</span>
                        {cited && <span className="cd-pill cd-pill-info shrink-0" style={{ fontSize: 10 }}>본문 인용</span>}
                        {src.score != null && (
                          <span className="cd-text-muted text-xs font-bold ml-auto shrink-0">{Math.round(src.score * 100)}%</span>
                        )}
                      </div>
                      <p className="cd-text-muted text-[12.5px] truncate">{src.reportName ?? "—"}</p>
                      {src.disclosedAt && <p className="cd-text-faint text-[11.5px]">{src.disclosedAt.slice(0, 10)}</p>}
                    </button>
                  );
                })}
              </div>
              {briefing.sources.length > SOURCE_PREVIEW_COUNT && (
                <button className="cd-btn cd-btn-ghost cd-btn-sm self-center" onClick={() => setShowAllSources((v) => !v)}>
                  {showAllSources ? (
                    <><ChevronUp className="w-3.5 h-3.5" /> 접기</>
                  ) : (
                    <><ChevronDown className="w-3.5 h-3.5" /> 전체 {briefing.sources.length}건 보기</>
                  )}
                </button>
              )}
            </div>
          </Section>
        )}
      </div>

      {/* 인용 호버 팝오버 */}
      {popover && (
        <div
          className="fixed pointer-events-none"
          style={{ left: popover.x, top: popover.y, zIndex: 60, transform: "translate(-50%, calc(-100% - 10px))", width: 330 }}
        >
          <div
            className="rounded-xl px-4 py-3 flex flex-col gap-1.5"
            style={{ background: "var(--cd-text)", color: "var(--cd-card)", boxShadow: "0 14px 36px rgba(16,22,36,0.32)" }}
          >
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center justify-center rounded font-bold"
                style={{ minWidth: 19, height: 19, padding: "0 5px", fontSize: 11, background: "var(--cd-primary)", color: "#fff" }}
              >
                {popover.n}
              </span>
              <span className="text-[10px] font-extrabold tracking-wider opacity-70">
                {(SOURCE_LABEL[popover.source.source] ?? popover.source.source).toUpperCase()}
              </span>
              <span className="text-[12.5px] font-bold truncate">{popover.source.companyName ?? "회사 미상"}</span>
              {popover.source.score != null && (
                <span className="text-[11px] opacity-60 ml-auto shrink-0">관련도 {Math.round(popover.source.score * 100)}%</span>
              )}
            </div>
            <p className="text-[12.5px] leading-relaxed opacity-85" style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
              {popover.source.reportName ?? "—"}
            </p>
            {popover.source.disclosedAt && <p className="text-[11px] opacity-55">{popover.source.disclosedAt.slice(0, 10)}</p>}
          </div>
          <div
            style={{ width: 12, height: 12, background: "var(--cd-text)", transform: "rotate(45deg)", margin: "-6px auto 0", borderRadius: 2 }}
          />
        </div>
      )}

      {/* 공유 모달 */}
      {shareOpen && (
        <BriefingShareModal briefingId={briefing.briefingId} theme={theme} onClose={() => setShareOpen(false)} />
      )}
    </article>
  );
}

// ── 공유 모달 — 영업 담당자 조직도 트리뷰에서 인원 선택 후 공유 ──

interface SharePick {
  userId: string;
  name: string;
}

function BriefingShareModal({
  briefingId,
  theme,
  onClose,
}: {
  briefingId: string;
  theme: string;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [picks, setPicks] = useState<SharePick[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sales/org", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSnapshot(d && Array.isArray(d.departments) ? d : null))
      .catch(() => setSnapshot(null));
  }, []);

  const tree = useMemo(() => filterAssigneeTree(snapshot), [snapshot]);

  const toggle = (emp: OrganizationEmployeeRow) => {
    if (!emp.userId) {
      setError(`${emp.name} 님은 계정이 연결되지 않아 공유할 수 없습니다.`);
      return;
    }
    setError(null);
    const userId = emp.userId;
    setPicks((prev) =>
      prev.some((p) => p.userId === userId)
        ? prev.filter((p) => p.userId !== userId)
        : [...prev, { userId, name: emp.name }]
    );
  };

  const share = async () => {
    if (!picks.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sales/rag/briefings/${briefingId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: picks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setMsg(`${picks.length}명에게 브리핑을 공유했습니다.`);
      setPicks([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    // 포털은 .cdash 밖이라 토큰이 안 풀린다 — 루트에 cdash-vars + data-theme 부여
    <div
      className="cdash-vars cd-fields-white fixed inset-0 z-[70] flex items-center justify-center p-4"
      data-theme={theme}
      style={{ background: "rgba(16,22,36,0.45)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cd-card-bg rounded-2xl border cd-border-c w-full max-w-md flex flex-col" style={{ maxHeight: "86vh" }}>
        <div className="flex items-center gap-2 px-5 py-4 border-b cd-border-c">
          <Share2 className="w-4 h-4 cd-text-faint" />
          <h3 className="cd-text text-[0.95rem] font-extrabold flex-1">브리핑 공유</h3>
          <button className="cd-btn cd-btn-ghost cd-btn-sm" title="닫기" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 flex flex-col gap-3 overflow-y-auto">
          <p className="cd-text-muted text-xs">조직도에서 공유할 인원을 클릭해 선택하세요. 선택한 인원의 RAG &amp; 영업 발굴 화면에 공유 브리핑이 표시됩니다.</p>
          {msg && <div className="cd-tint-primary rounded-xl px-3 py-2 text-xs cd-text">{msg}</div>}
          {error && <div className="cd-error-bg cd-error-text rounded-xl px-3 py-2 text-xs">{error}</div>}
          <div className="flex flex-wrap gap-1">
            {picks.map((p) => (
              <span key={p.userId} className="cd-pill cd-pill-info inline-flex items-center gap-1">
                {p.name}
                <button onClick={() => setPicks((prev) => prev.filter((x) => x.userId !== p.userId))}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {picks.length === 0 && <span className="cd-text-faint text-xs">선택된 인원이 없습니다.</span>}
          </div>
          {tree ? (
            <OrganizationTree snapshot={tree} embedded title="조직도" onSelectEmployee={toggle} />
          ) : (
            <div className="cd-text-faint text-sm p-4 text-center">조직도를 불러오는 중…</div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t cd-border-c">
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>닫기</button>
          <button className="cd-btn cd-btn-primary cd-btn-sm" disabled={busy || picks.length === 0} onClick={share}>
            {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {busy ? "공유 중…" : `공유 (${picks.length}명)`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
