"use client";

// "RAG & 영업 발굴" 메인 보드 (D단계) —
// 좌: AI 질의형 브리핑(질문 + 검색범위 → pgvector 검색 → Claude 보고서, 출처 [n] 클릭 시 신호 모달) + 브리핑 이력
// 우: 벡터 DB 적재 현황(미적재분 적재 버튼) + 영업 발굴 후보(매칭·확정/후보·미전환 → 영업건 전환)

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpenText, Database, RefreshCw, Send, Sparkles, Target, Trash2,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";
import type { Briefing, IntelSignal } from "./intel-shared";
import { GradeTag, RelevanceTag, SOURCE_LABEL, SOURCE_TABS, TypeTag } from "./intel-shared";
import { IntelSignalModal } from "./IntelSignalModal";
import { BriefingReportView } from "./BriefingReportView";

// ── 서버 응답 타입(rag-queries 와 동일 shape) ──

interface RagStatusData {
  embeddingReady: boolean;
  briefingReady: boolean;
  totalSignals: number;
  embedded: number;
  duplicates: number;
  bySource: Array<{ source: string; total: number; embedded: number }>;
  briefingCount: number;
}

interface DiscoveryCandidate {
  signalId: string;
  source: string;
  companyName: string | null;
  reportName: string | null;
  signalType: string;
  signalGrade: string;
  disclosedAt: string | null;
  facilityName: string | null;
  summary: string | null;
  industry: string | null;
  industryRelevance: string | null;
  relevanceNote: string | null;
}

const EXAMPLE_QUESTIONS = [
  "반도체 업종 최근 1년 투자·공장 신설 동향",
  "이차전지 관련 기업의 증설·신설 계획 요약",
  "충청권 산업단지 조성·입주 신호 정리",
];

// ── 메인 보드 ──

export function RagBoard() {
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as { role?: "admin" | "editor" | "viewer" } | undefined)?.role ?? "viewer";
  const canEdit = role === "admin" || role === "editor";
  const { theme } = useCdashTheme();

  // 현황·발굴 후보·이력
  const [status, setStatus] = useState<RagStatusData | null>(null);
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [briefings, setBriefings] = useState<Briefing[]>([]);

  const reloadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/sales/rag/status", { cache: "no-store" });
      if (res.ok) setStatus(await res.json());
    } catch { /* 현황 실패는 화면 유지 */ }
  }, []);
  const reloadCandidates = useCallback(async () => {
    try {
      const res = await fetch("/api/sales/rag/discovery", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
    } catch { /* noop */ }
  }, []);
  const reloadBriefings = useCallback(async () => {
    try {
      const res = await fetch("/api/sales/rag/briefings?limit=20", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setBriefings(Array.isArray(data.briefings) ? data.briefings : []);
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    reloadStatus(); reloadCandidates(); reloadBriefings();
  }, [reloadStatus, reloadCandidates, reloadBriefings]);

  // ── 브리핑 생성 ──
  const [question, setQuestion] = useState("");
  const [fSource, setFSource] = useState("");
  const [fGrade, setFGrade] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Briefing | null>(null);

  const generate = async (q?: string) => {
    const text = (q ?? question).trim();
    if (!text || genBusy) return;
    setGenBusy(true); setGenError(null);
    try {
      const filters: Record<string, string> = {};
      if (fSource) filters.source = fSource;
      if (fGrade) filters.grade = fGrade;
      if (fFrom) filters.from = fFrom;
      if (fTo) filters.to = fTo;
      const res = await fetch("/api/sales/rag/briefings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, filters }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setCurrent(data.briefing);
      await Promise.all([reloadBriefings(), reloadStatus()]);
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setGenBusy(false);
    }
  };

  const removeBriefing = async (briefingId: string) => {
    if (!window.confirm("이 브리핑을 삭제할까요?")) return;
    try {
      const res = await fetch(`/api/sales/rag/briefings/${briefingId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (current?.briefingId === briefingId) setCurrent(null);
      await Promise.all([reloadBriefings(), reloadStatus()]);
    } catch (e) {
      setGenError((e as Error).message);
    }
  };

  // ── 임베딩 적재 ──
  const [indexBusy, setIndexBusy] = useState(false);
  const [indexMsg, setIndexMsg] = useState<string | null>(null);

  const runIndex = async () => {
    if (indexBusy) return;
    setIndexBusy(true); setIndexMsg(null);
    try {
      const res = await fetch("/api/sales/rag/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 200 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setIndexMsg(`${data.indexed ?? 0}건 적재 완료 (남은 미적재 ${(data.remaining ?? 0).toLocaleString()}건)`);
      await reloadStatus();
    } catch (e) {
      setIndexMsg(`적재 실패: ${(e as Error).message}`);
    } finally {
      setIndexBusy(false);
    }
  };

  // ── 신호 모달(출처·발굴 후보 공용) — 상세 API 로 IntelSignal 확보 후 오픈 ──
  const [selected, setSelected] = useState<IntelSignal | null>(null);
  const openSignal = async (signalId: string) => {
    try {
      const res = await fetch(`/api/sales/intel/signals/${signalId}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setSelected(data.signal as IntelSignal);
    } catch (e) {
      setGenError(`신호를 불러오지 못했습니다: ${(e as Error).message}`);
    }
  };
  const embeddedPct = status && status.totalSignals > 0
    ? Math.round((status.embedded / status.totalSignals) * 100)
    : 0;

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<BookOpenText className="w-5 h-5" />}
        eyebrow="SALES & MARKETING"
        title="RAG & 영업 발굴"
        subtitle="수집 신호 전량을 벡터 DB에 축적해 질의형 AI 브리핑을 생성하고, 정제된 후보군으로 영업 대상을 발굴합니다."
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 items-start">
        {/* ── 좌측: AI 브리핑 + 이력 ── */}
        <div className="flex flex-col gap-4 min-w-0">
          <section className="cd-card-bg rounded-2xl border cd-border-c p-4">
            <div className="flex items-center gap-2 mb-3">
              <span
                className="inline-flex items-center justify-center w-8 h-8 rounded-xl"
                style={{ background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }}
              >
                <Sparkles className="w-4 h-4" />
              </span>
              <div>
                <h2 className="cd-text text-[0.95rem] font-extrabold leading-tight">AI 브리핑</h2>
                <p className="cd-text-muted text-xs">질문하면 축적된 신호를 검색해 근거 인용 보고서를 생성합니다.</p>
              </div>
            </div>

            {/* 질문 입력 바 (한 줄: 입력 + 범위 필터 + 실행) */}
            <div className="flex items-center gap-2 flex-wrap rounded-xl border cd-border-c px-3 py-2">
              <input
                className="flex-1 min-w-[220px] bg-transparent outline-none cd-text text-sm font-medium px-1"
                placeholder='질문을 입력하세요 — 예: "반도체 업종 최근 1년 투자·공장 신설 동향"'
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); if (canEdit) generate(); }
                }}
              />
              <select className="cd-select" style={{ width: "auto" }} value={fSource} onChange={(e) => setFSource(e.target.value)}>
                <option value="">소스 전체</option>
                {SOURCE_TABS.filter((t) => t.key).map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
              <select className="cd-select" style={{ width: "auto" }} value={fGrade} onChange={(e) => setFGrade(e.target.value)} title="검색 대상 등급 — 기본은 '제외' 등급을 뺀 전체">
                <option value="">등급 기본(제외 뺌)</option>
                <option value="all">등급 전체</option>
                <option value="confirmed">확정</option>
                <option value="candidate">후보</option>
                <option value="monitoring">관찰</option>
                <option value="excluded">제외</option>
              </select>
              <input type="date" className="cd-input" style={{ width: 132 }} value={fFrom} onChange={(e) => setFFrom(e.target.value)} title="일자(부터)" />
              <span className="cd-text-faint text-xs">~</span>
              <input type="date" className="cd-input" style={{ width: 132 }} value={fTo} onChange={(e) => setFTo(e.target.value)} title="일자(까지)" />
              <button
                className="cd-btn cd-btn-primary cd-btn-sm"
                disabled={genBusy || !question.trim() || !canEdit}
                title={canEdit ? "브리핑 생성" : "편집 권한이 필요합니다"}
                onClick={() => generate()}
              >
                {genBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {genBusy ? "생성 중…" : "브리핑 생성"}
              </button>
            </div>

            {/* 예시 질문 */}
            {!current && !genBusy && (
              <div className="flex items-center gap-1.5 flex-wrap mt-3">
                <span className="cd-text-faint text-xs">예시:</span>
                {EXAMPLE_QUESTIONS.map((q) => (
                  <button key={q} className="cd-chip cd-chip-sm" onClick={() => setQuestion(q)}>{q}</button>
                ))}
              </div>
            )}

            {genError && <div className="cd-error-bg cd-error-text rounded-xl px-4 py-3 text-sm mt-3">{genError}</div>}
            {genBusy && (
              <div className="cd-tint-primary rounded-xl px-4 py-3 text-sm mt-3 cd-text">
                신호 검색과 브리핑 생성 중입니다… (질문·범위에 따라 최대 1~2분)
              </div>
            )}
          </section>

          {/* 브리핑 리포트 */}
          {current && !genBusy && (
            <BriefingReportView briefing={current} onClose={() => setCurrent(null)} onOpenSignal={openSignal} />
          )}

          {/* 브리핑 이력 */}
          <section className="cd-card-bg rounded-2xl border cd-border-c p-4">
            <h2 className="cd-text text-[0.95rem] font-extrabold mb-2">브리핑 이력</h2>
            {briefings.length === 0 ? (
              <div className="cd-text-faint text-sm p-4 text-center rounded-xl border cd-border-c">
                아직 생성된 브리핑이 없습니다.
              </div>
            ) : (
              <div className="flex flex-col">
                {briefings.map((b) => (
                  <div
                    key={b.briefingId}
                    className="flex items-center gap-2 py-2 border-b cd-border-c last:border-b-0 min-w-0"
                  >
                    <button
                      className="flex-1 min-w-0 text-left"
                      title="브리핑 다시 보기"
                      onClick={() => { setCurrent(b); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                    >
                      <p className={`text-sm truncate ${current?.briefingId === b.briefingId ? "font-bold" : ""} cd-text`}>{b.question}</p>
                      <p className="cd-text-faint text-[11px]">
                        {b.createdAt?.slice(0, 16).replace("T", " ")} · 출처 {b.sources?.length ?? 0}건
                      </p>
                    </button>
                    {canEdit && (
                      <button className="cd-btn cd-btn-ghost cd-btn-sm shrink-0" title="삭제" onClick={() => removeBriefing(b.briefingId)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ── 우측: 벡터 DB 현황 + 영업 발굴 후보 ── */}
        <div className="flex flex-col gap-4 min-w-0">
          <section className="cd-card-bg rounded-2xl border cd-border-c p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 cd-text-faint" />
                <h2 className="cd-text text-[0.95rem] font-extrabold">벡터 DB 적재 현황</h2>
              </div>
              {canEdit && (
                <button className="cd-btn cd-btn-soft cd-btn-sm" disabled={indexBusy || !status?.embeddingReady} onClick={runIndex}>
                  {indexBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                  {indexBusy ? "적재 중…" : "미적재분 적재"}
                </button>
              )}
            </div>

            {status && !status.embeddingReady && (
              <div className="cd-error-bg cd-error-text rounded-xl px-3 py-2 text-xs mb-3">
                VOYAGE_API_KEY 미설정 — 벡터 검색 대신 키워드 검색으로 동작합니다.
              </div>
            )}
            {status && !status.briefingReady && (
              <div className="cd-error-bg cd-error-text rounded-xl px-3 py-2 text-xs mb-3">
                ANTHROPIC_API_KEY 미설정 — 브리핑 생성을 사용할 수 없습니다.
              </div>
            )}
            {indexMsg && <div className="cd-tint-primary rounded-xl px-3 py-2 text-xs mb-3 cd-text">{indexMsg}</div>}

            {status ? (
              <>
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="cd-text text-2xl font-extrabold">{status.embedded.toLocaleString()}</span>
                  <span className="cd-text-muted text-sm">/ {status.totalSignals.toLocaleString()}건 임베딩</span>
                  <span className="cd-text-faint text-xs ml-auto">{embeddedPct}%</span>
                </div>
                <div className="rounded-full overflow-hidden mb-3" style={{ height: 6, background: "var(--cd-surface)" }}>
                  <div style={{ width: `${embeddedPct}%`, height: "100%", background: "var(--cd-primary)", borderRadius: 6 }} />
                </div>
                <div className="flex flex-col">
                  {status.bySource.map((r) => (
                    <div key={r.source} className="flex items-center gap-2 py-1.5 border-b cd-border-c last:border-b-0">
                      <span className="cd-text text-xs font-bold" style={{ width: 72 }}>{SOURCE_LABEL[r.source] ?? r.source}</span>
                      <div className="flex-1 rounded-full overflow-hidden" style={{ height: 4, background: "var(--cd-surface)" }}>
                        <div
                          style={{
                            width: r.total ? `${Math.round((r.embedded / r.total) * 100)}%` : 0,
                            height: "100%", background: "var(--cd-primary)", borderRadius: 4,
                          }}
                        />
                      </div>
                      <span className="cd-text-muted text-[11px] shrink-0" style={{ minWidth: 88, textAlign: "right" }}>
                        {r.embedded.toLocaleString()} / {r.total.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="cd-text-faint text-[11px] mt-2">
                  브리핑 {status.briefingCount.toLocaleString()}건 생성됨
                  {status.duplicates > 0 ? ` · 중복 기사 ${status.duplicates.toLocaleString()}건 병합됨(검색 제외)` : ""}
                  {" · 야간 배치 수집분은 다음 적재 때 반영"}
                </p>
              </>
            ) : (
              <div className="cd-text-faint text-sm p-4">불러오는 중…</div>
            )}
          </section>

          {/* 영업 발굴 후보 */}
          <section className="cd-card-bg rounded-2xl border cd-border-c p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 cd-text-faint" />
              <h2 className="cd-text text-[0.95rem] font-extrabold">영업 발굴 후보</h2>
              <span className="cd-pill cd-pill-info">{candidates.length}</span>
            </div>
            <p className="cd-text-muted text-xs mb-3">사업장 매칭 + 확정·후보 등급 + 미전환 신호. 클릭해 영업건으로 전환하세요.</p>
            {candidates.length === 0 ? (
              <div className="cd-text-faint text-sm p-4 text-center rounded-xl border cd-border-c">
                발굴 후보가 없습니다.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5" style={{ maxHeight: 520, overflowY: "auto" }}>
                {candidates.map((c) => (
                  <button
                    key={c.signalId}
                    className="rounded-xl border cd-border-c px-3 py-2 text-left hover:cd-surface-bg min-w-0"
                    onClick={() => openSignal(c.signalId)}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                      <span className="cd-text text-sm font-bold truncate">{c.companyName ?? c.facilityName ?? "—"}</span>
                      <TypeTag type={c.signalType} />
                      <GradeTag grade={c.signalGrade} />
                      <RelevanceTag relevance={c.industryRelevance} note={c.relevanceNote} />
                      <span className="cd-pill cd-pill-outline">{SOURCE_LABEL[c.source] ?? c.source}</span>
                    </div>
                    <p className="cd-text-muted text-[11px] truncate mt-1">
                      {c.summary ?? c.reportName ?? "—"}
                    </p>
                    {c.industryRelevance === "supply_chain" && c.relevanceNote && (
                      <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: "var(--cd-primary)" }}>
                        ↳ {c.relevanceNote}
                      </p>
                    )}
                    <p className="cd-text-faint text-[11px] mt-0.5">
                      {c.facilityName ? `사업장 ${c.facilityName}` : ""}{c.disclosedAt ? ` · ${c.disclosedAt.slice(0, 10)}` : ""}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {selected && (
        <IntelSignalModal
          theme={theme}
          signal={selected}
          canEdit={canEdit}
          onClose={() => setSelected(null)}
          onChanged={() => { reloadCandidates(); }}
          onConverted={(projectId) => router.push(`/sales/${projectId}`)}
        />
      )}
    </div>
  );
}
