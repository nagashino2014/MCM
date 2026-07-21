"use client";

// "API&스크래핑" 메인 보드 (C단계 개편) —
// 좌: 소스 탭 + 필터 + 신호 리스트(서버 페이지네이션) + 일괄 작업 + 수집 설정 패널
// 우: 발주 정보 분석용 데이터 수집현황(총계·추이·소스별 채택·세부 유형)

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Radar, Search, Trash2, X, Wand2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { PaginationControls } from "@/components/ui/PaginationControls";
import "@/components/cdash/cdash.css";
import type { DeleteReasonCode, IntelSignal } from "./intel-shared";
import { DELETE_REASONS, GradeTag, MatchTypeTag, RelevanceTag, SOURCE_LABEL, SOURCE_TABS, STATUS_LABEL, STATUS_PILL, TypeTag } from "./intel-shared";
import { IntelSignalModal } from "./IntelSignalModal";
import { IntelStatsPanel, type IntelStatsData } from "./IntelStatsPanel";
import { IntelCollectSettingsPanel, type CollectStateRow } from "./IntelCollectSettingsPanel";

const PAGE_SIZE = 20;

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function IntelBoard() {
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as { role?: "admin" | "editor" | "viewer" } | undefined)?.role ?? "viewer";
  const canEdit = role === "admin" || role === "editor";
  const { theme } = useCdashTheme();

  // ── 리스트 상태(서버 필터·페이지네이션) ──
  const [signals, setSignals] = useState<IntelSignal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<IntelSignal | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const [source, setSource] = useState(""); // 소스 탭
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [signalType, setSignalType] = useState("");
  const [matchStatus, setMatchStatus] = useState("");
  const [status, setStatus] = useState("");
  const [grade, setGrade] = useState(""); // ''=확정+후보 기본, 'all'=전체, 특정등급
  const [relevance, setRelevance] = useState(""); // 업종 관련성 필터(''=전체 노출)
  const [includeDup, setIncludeDup] = useState(false); // 중복(변형 기사) 포함 여부
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // 필터 변경 시 1페이지로
  useEffect(() => { setOffset(0); setCheckedIds(new Set()); }, [source, qDebounced, signalType, matchStatus, status, grade, relevance, includeDup]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (source) params.set("source", source);
      if (qDebounced) params.set("q", qDebounced);
      if (signalType) params.set("signalType", signalType);
      if (matchStatus) params.set("matchStatus", matchStatus);
      if (status) params.set("status", status);
      if (grade) params.set("grade", grade);
      if (relevance) params.set("relevance", relevance);
      if (includeDup) params.set("includeDuplicates", "1");
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      const res = await fetch(`/api/sales/intel/signals?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      const data = await res.json();
      setSignals(Array.isArray(data.signals) ? data.signals : []);
      setTotal(Number(data.total ?? 0));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [source, qDebounced, signalType, matchStatus, status, grade, relevance, includeDup, offset]);

  useEffect(() => { reload(); }, [reload]);

  // ── 통계 상태 ──
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [stats, setStats] = useState<IntelStatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const collectState: CollectStateRow[] = stats?.collectState ?? [];

  const reloadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const { from, to } = monthRange(month);
      const res = await fetch(`/api/sales/intel/stats?from=${from}&to=${to}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStats(await res.json());
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, [month]);

  useEffect(() => { reloadStats(); }, [reloadStats]);

  // ── 일괄 작업 ──
  const runBulk = async (body: Record<string, unknown>, confirmText: string, done: (data: Record<string, unknown>) => string) => {
    if (!window.confirm(confirmText)) return;
    setBulkBusy(true); setBulkMsg(null);
    try {
      const res = await fetch("/api/sales/intel/signals/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setBulkMsg(done(data));
      setCheckedIds(new Set());
      await Promise.all([reload(), reloadStats()]);
    } catch (e) {
      setBulkMsg(`일괄 작업 실패: ${(e as Error).message}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const sourceLabel = SOURCE_TABS.find((t) => t.key === source)?.label ?? "전체";
  const bulkButtons = (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        className="cd-btn cd-btn-ghost cd-btn-sm"
        disabled={bulkBusy}
        onClick={() =>
          runBulk(
            { action: "deleteByGrade", grade: "excluded", source: source || undefined },
            `'제외' 등급 신호를 일괄 삭제합니다 (소스: ${sourceLabel}). 삭제된 건은 재수집 시 다시 들어올 수 있습니다. 계속할까요?`,
            (d) => `제외 등급 ${d.deleted ?? 0}건 삭제`
          )
        }
      >
        제외 일괄 삭제
      </button>
      <button
        className="cd-btn cd-btn-ghost cd-btn-sm"
        disabled={bulkBusy}
        onClick={() =>
          runBulk(
            { action: "deleteByGrade", grade: "monitoring", source: source || undefined },
            `'관찰' 등급 신호를 일괄 삭제합니다 (소스: ${sourceLabel}). 계속할까요?`,
            (d) => `관찰 등급 ${d.deleted ?? 0}건 삭제`
          )
        }
      >
        관찰 일괄 삭제
      </button>
      <button
        className="cd-btn cd-btn-soft cd-btn-sm"
        disabled={bulkBusy || checkedIds.size === 0}
        title="선택 신호 중 사업장 매칭·미전환 건을 영업건으로 일괄 생성"
        onClick={() =>
          runBulk(
            { action: "convertMatched", signalIds: [...checkedIds] },
            `선택 ${checkedIds.size}건 중 사업장이 매칭된 신호를 영업건으로 일괄 편입합니다. 계속할까요?`,
            (d) => `영업건 편입 ${d.converted ?? 0}건 (건너뜀 ${d.skipped ?? 0}건 — 미매칭·기전환)`
          )
        }
      >
        매칭 일괄 편입
      </button>
      <button
        className="cd-btn cd-btn-danger cd-btn-sm"
        disabled={bulkBusy || checkedIds.size === 0}
        onClick={() =>
          runBulk(
            { action: "deleteSelected", signalIds: [...checkedIds] },
            `선택한 ${checkedIds.size}건을 삭제합니다. 계속할까요?`,
            (d) => `선택 ${d.deleted ?? 0}건 삭제`
          )
        }
      >
        선택 일괄 삭제
      </button>
    </div>
  );

  // ── 개별 삭제(사유 필수 + 상세 이유 선택 — 오인·중복 수집 피드백을 수집 로직 개선에 활용) ──
  const [deleteTarget, setDeleteTarget] = useState<IntelSignal | null>(null);
  const [deleteReason, setDeleteReason] = useState<DeleteReasonCode | null>(null);
  const [deleteNote, setDeleteNote] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  const openDeletePopup = (sig: IntelSignal) => {
    setDeleteReason(null);
    setDeleteNote("");
    setDeleteTarget(sig);
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !deleteReason || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/sales/intel/signals/${deleteTarget.signalId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: deleteReason, note: deleteNote.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      const label = DELETE_REASONS.find((r) => r.code === deleteReason)?.label ?? deleteReason;
      setBulkMsg(
        `'${deleteTarget.companyName ?? deleteTarget.reportName ?? "신호"}' 삭제 — 사유: ${label}` +
          `${deleteNote.trim() ? ` (${deleteNote.trim()})` : ""} · 이 건만 재수집 차단(회사·업종 전체 차단 아님)`
      );
      setDeleteTarget(null);
      await Promise.all([reload(), reloadStats()]);
    } catch (e) {
      setBulkMsg(`삭제 실패: ${(e as Error).message}`);
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const allChecked = signals.length > 0 && signals.every((s) => checkedIds.has(s.signalId));
  const toggleAll = () =>
    setCheckedIds(allChecked ? new Set() : new Set(signals.map((s) => s.signalId)));
  const toggleOne = (id: string) =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const hasFilter = !!(q || signalType || matchStatus || status || grade || relevance || includeDup);

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<Radar className="w-5 h-5" />}
        eyebrow="SALES & MARKETING"
        title="API & 스크래핑"
        titleSuffix={`${total.toLocaleString()}건`}
        subtitle="공시·환경영향평가·보도자료·뉴스·고시에서 통합허가 대상 사업장의 투자·증설·신설 신호를 수집해 선별합니다."
        actions={
          canEdit ? (
            <Link href="/sales/intel/sources" className="cd-chip">
              <Wand2 className="w-3.5 h-3.5" /> 커스텀 소스
            </Link>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 items-start">
        {/* ── 좌측: 리스트 + 수집 설정 ── */}
        <div className="flex flex-col gap-4 min-w-0">
          <section className="cd-card-bg rounded-2xl border cd-border-c p-4">
            {/* 소스 탭 */}
            <div className="flex items-center gap-1 flex-wrap mb-3">
              {SOURCE_TABS.map((t) => (
                <button key={t.key} className="cd-chip cd-chip-sm" data-active={source === t.key} onClick={() => setSource(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* 필터 행 */}
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <div className="flex items-center gap-1.5">
                <Search className="w-4 h-4 cd-text-faint" />
                <input className="cd-input" style={{ width: 200 }} placeholder="회사명·공시명 검색" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
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
              <select className="cd-select" style={{ width: "auto" }} value={relevance} onChange={(e) => setRelevance(e.target.value)} title="통합허가 대상 업종과의 상관도(등급과 별개 축)">
                <option value="">관련성 전체</option>
                <option value="direct">직접</option>
                <option value="supply_chain">공급망</option>
                <option value="low">낮음</option>
                <option value="none">무관</option>
              </select>
              <label className="inline-flex items-center gap-1.5 cd-text-muted text-xs cursor-pointer" title="같은 사건의 변형 기사(중복 병합 마킹)도 표시">
                <input type="checkbox" checked={includeDup} onChange={(e) => setIncludeDup(e.target.checked)} />
                중복 포함
              </label>
              {hasFilter && (
                <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => { setQ(""); setSignalType(""); setMatchStatus(""); setStatus(""); setGrade(""); setRelevance(""); setIncludeDup(false); }}>
                  <X className="w-3.5 h-3.5" /> 초기화
                </button>
              )}
            </div>

            {error && <div className="cd-error-bg cd-error-text rounded-xl px-4 py-3 text-sm mb-3">{error}</div>}
            {bulkMsg && <div className="cd-tint-primary rounded-xl px-4 py-2.5 text-sm mb-3 cd-text">{bulkMsg}</div>}

            {/* 신호 리스트 */}
            {loading && signals.length === 0 ? (
              <div className="cd-text-faint text-sm p-6">불러오는 중…</div>
            ) : signals.length === 0 ? (
              <div className="cd-text-faint text-sm p-6 text-center rounded-xl border cd-border-c">
                조건에 맞는 신호가 없습니다.
              </div>
            ) : (
              <div className="rounded-xl border cd-border-c overflow-hidden">
                <div className="overflow-auto">
                  <table className="cd-table">
                    <thead>
                      <tr>
                        {canEdit && (
                          <th style={{ width: 34 }}>
                            <input type="checkbox" checked={allChecked} onChange={toggleAll} title="현재 페이지 전체 선택" />
                          </th>
                        )}
                        <th>회사명</th>
                        <th>신호유형</th>
                        <th>등급</th>
                        <th>관련성</th>
                        <th>공시명</th>
                        <th>공시일</th>
                        <th>수집일</th>
                        <th>매칭 사업장</th>
                        <th>상태</th>
                        <th>원문</th>
                        {canEdit && <th style={{ width: 40 }}></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {signals.map((sig) => (
                        <tr key={sig.signalId} className="cursor-pointer" onClick={() => setSelected(sig)}>
                          {canEdit && (
                            <td onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={checkedIds.has(sig.signalId)} onChange={() => toggleOne(sig.signalId)} />
                            </td>
                          )}
                          <td className="cd-text font-bold">
                            {sig.companyName ?? "—"} <MatchTypeTag type={sig.matchType} />
                            {sig.duplicateOf && (
                              <span className="cd-pill cd-pill-outline ml-1" title="같은 사건의 변형 기사 — 대표 신호에 병합됨">중복</span>
                            )}
                          </td>
                          <td><TypeTag type={sig.signalType} /></td>
                          <td><GradeTag grade={sig.signalGrade} /></td>
                          <td><RelevanceTag relevance={sig.industryRelevance} note={sig.relevanceNote} /></td>
                          <td className="cd-text-muted">{sig.reportName ?? "—"}</td>
                          <td className="cd-text-muted tabular-nums">{sig.disclosedAt ? sig.disclosedAt.slice(0, 10) : "—"}</td>
                          <td className="cd-text-muted tabular-nums">{sig.createdAt ? sig.createdAt.slice(0, 10) : "—"}</td>
                          <td className={sig.facilityName ? "cd-text" : "cd-text-faint"}>{sig.facilityName ?? "미매칭"}</td>
                          <td><span className={`cd-pill ${STATUS_PILL[sig.status] ?? "cd-pill-idle"}`}>{STATUS_LABEL[sig.status] ?? sig.status}</span></td>
                          <td onClick={(e) => e.stopPropagation()}>
                            {sig.url ? (
                              <a href={sig.url} target="_blank" rel="noreferrer" className="cd-text-primary inline-flex items-center gap-1 text-xs">
                                <ExternalLink className="w-3.5 h-3.5" /> {SOURCE_LABEL[sig.source] ?? sig.source}
                              </a>
                            ) : "—"}
                          </td>
                          {canEdit && (
                            <td onClick={(e) => e.stopPropagation()}>
                              <button
                                className="cd-btn cd-btn-ghost cd-btn-sm"
                                style={{ padding: "0.25rem" }}
                                title="이 신호 삭제(사유 선택 — 재수집 차단·수집 로직 개선에 반영)"
                                onClick={() => openDeletePopup(sig)}
                              >
                                <Trash2 className="w-3.5 h-3.5 cd-error-text" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 페이지네이션 + 일괄 작업 */}
            <div className="flex items-center justify-between gap-3 flex-wrap mt-3">
              {canEdit ? bulkButtons : <span />}
              <PaginationControls total={total} limit={PAGE_SIZE} offset={offset} loading={loading} onPageChange={setOffset} />
            </div>
          </section>

          {/* 수집 설정(C-3) */}
          <IntelCollectSettingsPanel
            canEdit={canEdit}
            collectState={collectState}
            onCollected={() => { reload(); reloadStats(); }}
          />
        </div>

        {/* ── 우측: 수집현황(C-2) ── */}
        <IntelStatsPanel theme={theme} stats={stats} loading={statsLoading} month={month} onMonthChange={setMonth} />
      </div>

      {/* 삭제 사유 팝업 — 사유는 피드백 테이블에 축적되어 재수집 차단·분류 로직 튜닝에 쓰인다 */}
      {deleteTarget && (
        <div className="cd-modal-overlay cdash cd-fields-white" data-theme={theme} onClick={() => !deleteBusy && setDeleteTarget(null)}>
          <div className="cd-modal cd-card-bg w-full" style={{ maxWidth: 420, padding: "1.25rem" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-1">
              <h3 className="cd-text text-base font-extrabold">삭제 사유 선택</h3>
              <button className="cd-btn cd-btn-ghost cd-btn-sm shrink-0" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="cd-text-muted text-xs mb-1 truncate">
              {deleteTarget.companyName ?? "—"} · {deleteTarget.reportName ?? "—"}
            </p>
            <p className="cd-text-faint text-[11px] mb-3">
              사유는 수집 로직 개선에 반영됩니다. 삭제해도 이 건(기사·공시 1건)만 재수집이 차단되며,
              같은 회사·업종의 다른 정보는 계속 수집됩니다.
            </p>
            <div className="flex flex-col gap-2">
              {DELETE_REASONS.map((r) => {
                const active = deleteReason === r.code;
                return (
                  <button
                    key={r.code}
                    className="cd-row-hover w-full text-left rounded-xl border px-3 py-2.5 disabled:opacity-50"
                    style={active
                      ? { borderColor: "var(--cd-primary)", background: "var(--cd-primary-soft)" }
                      : { borderColor: "var(--cd-border)" }}
                    disabled={deleteBusy}
                    onClick={() => setDeleteReason(r.code)}
                  >
                    <span className="cd-text text-sm font-bold">{r.label}</span>
                    <span className="cd-text-faint text-[11px] block mt-0.5">{r.desc}</span>
                  </button>
                );
              })}
            </div>
            {/* 상세 이유(선택) — 사유 코드의 과일반화 방지: 배제의 정확한 조건을 분류기에 전달 */}
            <div className="mt-3">
              <label className="cd-label">상세 이유 (선택 — 수집 로직이 더 정확히 배웁니다)</label>
              <input
                className="cd-input w-full"
                maxLength={200}
                placeholder="예: 풍력발전이라 제외 — 발전 업종 자체는 수집 대상"
                value={deleteNote}
                onChange={(e) => setDeleteNote(e.target.value)}
                disabled={deleteBusy}
                onKeyDown={(e) => { if (e.key === "Enter" && deleteReason) confirmDelete(); }}
              />
              <p className="cd-text-faint text-[10px] mt-1 leading-snug">
                &ldquo;왜 이 건만 제외인지&rdquo;를 적어두면, 같은 회사·업종의 정상 신호까지 배제되는 것을 막는 데 쓰입니다.
              </p>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
                취소
              </button>
              <button className="cd-btn cd-btn-danger cd-btn-sm" onClick={confirmDelete} disabled={deleteBusy || !deleteReason}>
                {deleteBusy ? "삭제 중…" : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <IntelSignalModal
          theme={theme}
          signal={selected}
          canEdit={canEdit}
          onClose={() => setSelected(null)}
          onChanged={() => { reload(); reloadStats(); }}
          onConverted={(projectId) => router.push(`/sales/${projectId}`)}
        />
      )}
    </div>
  );
}
