"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, FileText, Save, Send } from "lucide-react";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { OrganizationEmployeeRow, OrganizationSnapshot } from "@/components/admin/users/types";
import {
  BONUS_TARGET_DEPT_IDS,
  EXEC_RANK_CUTOFF,
} from "@/lib/bonus/shared";
import type { AllocationBoard, StatementDetail, StatementOverviewRow } from "@/lib/bonus/statements";

const BUCKET_LABELS: Record<string, string> = {
  participant: "참여인력",
  dept_head: "본부장",
  support: "영업/지원",
  exec: "임원",
};

function fmtAmount(v: number): string {
  return Math.round(v).toLocaleString();
}

function fmtDate(v: string | null): string {
  return v ? v.slice(0, 10) : "-";
}

function tenureLabel(hiredAt: string | null): string {
  if (!hiredAt) return "-";
  const hired = new Date(hiredAt.slice(0, 10));
  if (Number.isNaN(hired.getTime())) return "-";
  const months = Math.max(0, Math.floor((Date.now() - hired.getTime()) / (30.4375 * 86400000)));
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y > 0 ? `${y}년 ${m}개월` : `${m}개월`;
}

function changeRate(prev: number | null, total: number): string {
  if (prev == null || prev === 0) return "-";
  const rate = ((total - prev) / prev) * 100;
  return `${rate >= 0 ? "+" : ""}${rate.toFixed(1)}%`;
}

export default function BonusStatementsBoard() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [half, setHalf] = useState<"H1" | "H2">(now.getMonth() < 6 ? "H1" : "H2");
  const [tab, setTab] = useState<"statements" | "related">("statements");
  const [view, setView] = useState<"all" | "individual">("all");
  const [overview, setOverview] = useState<StatementOverviewRow[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [detail, setDetail] = useState<StatementDetail | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<OrganizationEmployeeRow | null>(null);
  const [board, setBoard] = useState<AllocationBoard | null>(null);
  const [allocDraft, setAllocDraft] = useState<Record<string, number>>({});
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const period = `${year}-${half}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, al] = await Promise.all([
        fetch(`/api/bonus/statements?period=${period}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/bonus/allocations?period=${period}`, { cache: "no-store" }).then((r) => r.json()),
      ]);
      setOverview(ov.overview ?? []);
      setIsAdmin(Boolean(ov.isAdmin));
      setBoard(al.board ?? null);
      setAllocDraft({});
    } catch {
      setOverview([]);
      setBoard(null);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    setDetail(null);
    setSelectedEmployee(null);
    setMsg(null);
    void load();
  }, [load]);

  useEffect(() => {
    fetch("/api/organization", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: OrganizationSnapshot | null) => {
        if (!d) return;
        // 상세 산정 대상 = 통합1/2·화학안전·연구소·울산지사, 임원 컷오프(rank>=82) 제외
        setSnapshot({
          ...d,
          departments: d.departments.filter((dept) => BONUS_TARGET_DEPT_IDS.includes(dept.deptId)),
          employees: d.employees.filter(
            (e) =>
              e.status === "active" &&
              e.deptId != null &&
              BONUS_TARGET_DEPT_IDS.includes(e.deptId) &&
              (e.positionRankOrder == null || e.positionRankOrder < EXEC_RANK_CUTOFF)
          ),
        });
      })
      .catch(() => setSnapshot(null));
  }, []);

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [y + 1, y, y - 1, y - 2];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDetail = async (emp: OrganizationEmployeeRow) => {
    setSelectedEmployee(emp);
    setView("individual");
    setTab("statements");
    try {
      const d = await fetch(
        `/api/bonus/statements?period=${period}&employeeId=${encodeURIComponent(emp.employeeId)}`,
        { cache: "no-store" }
      ).then((r) => r.json());
      setDetail(d.detail ?? null);
    } catch {
      setDetail(null);
    }
  };

  const calculate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/bonus/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "일괄산정에 실패했습니다.");
      const s = data.summary;
      setMsg(
        `일괄산정 완료 — 참여인력 ${s.participants}명 · 본부장 ${s.deptHeads}건 · ` +
          `기준액 ${fmtAmount(s.totalTarget)}원` +
          (s.unassignedDeptContracts ? ` · 수행부서 미지정 ${s.unassignedDeptContracts}건(본부장 차감 제외)` : "")
      );
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createDraft = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/bonus/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "기안 생성에 실패했습니다.");
      setMsg("지급 계획 기안이 생성되었습니다. 기안 화면에서 검토 후 상신하세요.");
      window.open(data.href, "_blank");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendStatements = async (employeeIds?: string[]) => {
    const label = employeeIds?.length ? "선택 인원에게" : "참여인력·본부장 전원에게";
    if (!window.confirm(`${label} 지급 명세서 이메일(PDF 첨부)을 발송합니다. 진행할까요?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/bonus/statements/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, employeeIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "발송에 실패했습니다.");
      const r = data.result;
      const parts = [`발송 ${r.sent}건`];
      if (r.skipped.length) parts.push(`스킵 ${r.skipped.length}건(${r.skipped.map((s: { name: string; reason: string }) => `${s.name}:${s.reason}`).join(", ")})`);
      if (r.failed.length) parts.push(`실패 ${r.failed.length}건(${r.failed.map((f: { name: string }) => f.name).join(", ")})`);
      setMsg(`명세서 발송 완료 — ${parts.join(" · ")}`);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveAlloc = async () => {
    if (!board) return;
    setBusy(true);
    setMsg(null);
    try {
      const rows = board.people.map((pn) => ({
        employeeId: pn.employeeId,
        bucket: pn.bucket,
        amount: allocDraft[pn.employeeId] ?? pn.amount,
      }));
      const res = await fetch("/api/bonus/allocations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, rows }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "배분 저장에 실패했습니다.");
      setMsg("배분이 저장되었습니다. 일괄산정을 다시 실행하면 명세에 반영됩니다.");
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const allocUsed = useMemo(() => {
    if (!board) return { support: 0, exec: 0 };
    const used = { support: 0, exec: 0 };
    for (const pn of board.people) {
      used[pn.bucket] += allocDraft[pn.employeeId] ?? pn.amount;
    }
    return used;
  }, [board, allocDraft]);

  const periodLabel = `${year}년 ${half === "H1" ? "상반기" : "하반기"}`;

  return (
    <>
      <CdPageHeader
        title="지급 명세서 생성"
        actions={
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs cd-text-faint whitespace-nowrap">대상 :</span>
            <select className="cd-select text-sm" style={{ minWidth: 100 }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
            <select className="cd-select text-sm" value={half} onChange={(e) => setHalf(e.target.value as "H1" | "H2")}>
              <option value="H1">상반기</option>
              <option value="H2">하반기</option>
            </select>
            {isAdmin && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={calculate}
                  className="rounded-xl px-4 py-2 text-sm text-white cd-fill-primary inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Calculator className="w-4 h-4" /> {busy ? "산정 중..." : "일괄산정"}
                </button>
                <button
                  type="button"
                  disabled={busy || overview.length === 0}
                  onClick={createDraft}
                  className="rounded-xl px-4 py-2 text-sm font-semibold border cd-border-c cd-text inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0"
                  title="산정 결과를 표로 담은 지급 계획서를 기안(대표이사 직결)합니다"
                >
                  <FileText className="w-4 h-4" /> 성과급 기안
                </button>
              </>
            )}
          </div>
        }
      />

      <div className="flex flex-1 min-h-0 gap-4">
        {/* 좌측 사이드바 */}
        <aside className="w-64 shrink-0 flex flex-col gap-4 overflow-y-auto scrollbar-hide">
          <section className="cd-card rounded-3xl p-4 cd-reveal delay-1 flex flex-col gap-2">
            <h3 className="text-xs font-bold cd-text-faint">조직도 (성과급 상세 산정 대상자)</h3>
            {snapshot ? (
              <OrganizationTree
                snapshot={snapshot}
                embedded
                hideHeader
                selectedEmployeeId={selectedEmployee?.employeeId ?? null}
                onSelectEmployee={openDetail}
              />
            ) : (
              <p className="text-[12px] cd-text-faint py-6 text-center">조직도를 불러오는 중입니다.</p>
            )}
            <p className="text-[10px] leading-relaxed cd-text-faint">
              인원을 클릭하면 개별 산정 내역을 표시합니다. 임원급(연구소장 이상)은 제외됩니다.
            </p>
          </section>

          <section className="cd-card rounded-3xl p-4 cd-reveal delay-2 flex flex-col gap-2.5 grow">
            <h3 className="text-xs font-bold cd-text-faint">산정방식 옵션</h3>
            <label className="flex items-start gap-2 text-sm cd-text">
              <input type="checkbox" checked readOnly className="mt-0.5" />
              <span>
                기존 산정방식
                <span className="block text-[10px] cd-text-faint">지급대상 총액 규모를 매출액의 3.5~5% 적용</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm cd-text-faint">
              <input type="checkbox" disabled className="mt-0.5" />
              <span>
                인건비 반영 산정
                <span className="block text-[10px]">급여 데이터 구축 후 제공 예정</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm cd-text-faint">
              <input type="checkbox" disabled className="mt-0.5" />
              <span>
                영업이익 기반 산정
                <span className="block text-[10px]">후속 제공 예정</span>
              </span>
            </label>
          </section>

          <section className="cd-card rounded-3xl p-4 cd-reveal delay-3 flex flex-col gap-2 grow">
            <h3 className="text-xs font-bold cd-text-faint">비율 조정</h3>
            <label className="flex items-center justify-between gap-2 text-sm cd-text-faint">
              <span className="text-xs">인건비 반영 시 매출액 중 적용 비율</span>
              <span className="flex items-center gap-1">
                <input type="number" disabled className="cd-input text-sm text-right" style={{ width: 56 }} value="" readOnly />
                <span className="text-xs">%</span>
              </span>
            </label>
            <label className="flex items-center justify-between gap-2 text-sm cd-text-faint">
              <span className="text-xs">영업이익 기반 산정 시 적용 비율</span>
              <span className="flex items-center gap-1">
                <input type="number" disabled className="cd-input text-sm text-right" style={{ width: 56 }} value="" readOnly />
                <span className="text-xs">%</span>
              </span>
            </label>
          </section>
        </aside>

        {/* 우측 탭 카드 */}
        <section className="cd-card rounded-3xl p-4 cd-reveal delay-1 flex-1 min-h-0 flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setTab("statements")}
              className={`rounded-xl px-4 py-2 text-sm font-semibold border ${
                tab === "statements" ? "cd-fill-primary text-white border-transparent" : "cd-border-c cd-text"
              }`}
            >
              참여인력 성과 명세
            </button>
            <button
              type="button"
              onClick={() => setTab("related")}
              className={`rounded-xl px-4 py-2 text-sm font-semibold border ${
                tab === "related" ? "cd-fill-primary text-white border-transparent" : "cd-border-c cd-text"
              }`}
            >
              유관부서/인력 명세
            </button>
            {tab === "statements" && (
              <span className="inline-flex rounded-xl border cd-border-c overflow-hidden ml-2">
                <button
                  type="button"
                  onClick={() => setView("all")}
                  className={`px-3 py-1.5 text-xs font-semibold ${view === "all" ? "cd-fill-primary text-white" : "cd-text"}`}
                >
                  전체
                </button>
                <button
                  type="button"
                  onClick={() => setView("individual")}
                  className={`px-3 py-1.5 text-xs font-semibold ${view === "individual" ? "cd-fill-primary text-white" : "cd-text"}`}
                >
                  개별
                </button>
              </span>
            )}
            <span className="text-xs cd-text-faint">{periodLabel}</span>
            <div className="ml-auto flex items-center gap-2">
              {msg && <span className="text-[11px] cd-text-faint max-w-[420px] truncate" title={msg}>{msg}</span>}
              {tab === "statements" && view === "all" && isAdmin && overview.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => sendStatements()}
                  className="rounded-xl px-4 py-2 text-sm text-white cd-fill-primary inline-flex items-center gap-1.5 disabled:opacity-50"
                  title="참여인력·본부장 전원에게 명세서 이메일(PDF 첨부)을 발송합니다"
                >
                  <Send className="w-4 h-4" /> 명세서 일괄 발송
                </button>
              )}
              {tab === "related" && isAdmin && (
                <button
                  type="button"
                  disabled={busy || !board}
                  onClick={saveAlloc}
                  className="rounded-xl px-4 py-2 text-sm text-white cd-fill-primary inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" /> 배분 저장
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            {loading ? (
              <div className="p-10 text-center text-sm cd-text-faint">불러오는 중…</div>
            ) : tab === "statements" && view === "all" ? (
              overview.length === 0 ? (
                <div className="p-10 text-center text-sm cd-text-faint">
                  산정 결과가 없습니다. 참여도·평점 입력 후 우상단 [일괄산정]을 실행하세요.
                </div>
              ) : (
                <table className="w-full text-sm" style={{ minWidth: 860 }}>
                  <thead>
                    <tr className="cd-text-faint text-[11px] border-b cd-border-c">
                      <th className="text-left font-semibold p-2.5">성명</th>
                      <th className="text-left font-semibold p-2.5">소속</th>
                      <th className="text-left font-semibold p-2.5">직함</th>
                      <th className="text-left font-semibold p-2.5">근속연수</th>
                      <th className="text-left font-semibold p-2.5">구분</th>
                      <th className="text-right font-semibold p-2.5">전기 성과급</th>
                      <th className="text-right font-semibold p-2.5">금기 성과급</th>
                      <th className="text-right font-semibold p-2.5">변동율</th>
                      <th className="text-left font-semibold p-2.5" style={{ width: 170 }}>명세서</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.map((row) => (
                      <tr key={row.employeeId} className="border-b cd-border-c last:border-b-0">
                        <td className="p-2.5 cd-text font-medium">{row.employeeName}</td>
                        <td className="p-2.5 cd-text">{row.deptName ?? "-"}</td>
                        <td className="p-2.5 cd-text">{row.positionName ?? "-"}</td>
                        <td className="p-2.5 cd-text whitespace-nowrap">{tenureLabel(row.hiredAt)}</td>
                        <td className="p-2.5">
                          <span className="text-[11px] font-semibold rounded-md px-1.5 py-0.5 border cd-border-c cd-text-faint">
                            {BUCKET_LABELS[row.bucket] ?? row.bucket}
                          </span>
                        </td>
                        <td className="p-2.5 text-right cd-text">
                          {row.prevAmount != null ? fmtAmount(row.prevAmount) : "-"}
                        </td>
                        <td className="p-2.5 text-right cd-text font-semibold">{fmtAmount(row.totalAmount)}</td>
                        <td className="p-2.5 text-right cd-text">{changeRate(row.prevAmount, row.totalAmount)}</td>
                        <td className="p-2.5">
                          {row.bucket === "participant" || row.bucket === "dept_head" ? (
                            <span className="flex items-center gap-1.5 whitespace-nowrap">
                              {isAdmin && (
                                <>
                                  <a
                                    href={`/api/bonus/statements/pdf?period=${period}&employeeId=${encodeURIComponent(row.employeeId)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[11px] font-semibold rounded-md px-1.5 py-0.5 border cd-border-c cd-text"
                                    title="명세서 PDF 미리보기"
                                  >
                                    PDF
                                  </a>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => sendStatements([row.employeeId])}
                                    className="text-[11px] font-semibold rounded-md px-1.5 py-0.5 border cd-border-c cd-text disabled:opacity-50"
                                    title={row.email ? `${row.email}로 발송` : "이메일 미등록"}
                                  >
                                    발송
                                  </button>
                                </>
                              )}
                              {row.lastSentAt && (
                                <span
                                  className="text-[10px] cd-text-faint"
                                  title={`최근 발송 상태: ${row.lastSendStatus ?? "-"}`}
                                >
                                  {row.lastSendStatus === "sent" ? "✓" : "✗"} {row.lastSentAt.slice(0, 10)}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-[10px] cd-text-faint">발송 대상 아님</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : tab === "statements" ? (
              !selectedEmployee ? (
                <div className="p-10 text-center text-sm cd-text-faint">
                  좌측 조직도에서 인원을 선택하면 용역별 산정 내역을 표시합니다.
                </div>
              ) : !detail ? (
                <div className="p-10 text-center text-sm cd-text-faint">
                  {selectedEmployee.name} 님의 {periodLabel} 산정 결과가 없습니다. (일괄산정 미실행 또는 참여 없음)
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-4 p-3 rounded-2xl border cd-border-c">
                    <span className="cd-text font-bold">{selectedEmployee.name}</span>
                    <span className="text-xs cd-text-faint">{BUCKET_LABELS[detail.bucket] ?? detail.bucket}</span>
                    <span className="ml-auto text-xs cd-text-faint">
                      전기 {detail.prevAmount != null ? `${fmtAmount(detail.prevAmount)}원` : "-"}
                    </span>
                    <span className="cd-text font-extrabold">금기 {fmtAmount(detail.totalAmount)}원</span>
                  </div>
                  {Object.keys((detail.meta?.deptHeadAmounts as Record<string, number>) ?? {}).length > 0 && (
                    <p className="text-[11px] cd-text-faint px-1">
                      본부장 산정 포함:{" "}
                      {Object.entries((detail.meta.deptHeadAmounts as Record<string, number>) ?? {})
                        .map(([d, amt]) => `${d} ${fmtAmount(Number(amt))}원`)
                        .join(" · ")}
                    </p>
                  )}
                  {detail.lines.length === 0 ? (
                    <p className="p-6 text-center text-sm cd-text-faint">용역별 참여 산정 내역이 없습니다.</p>
                  ) : (
                    <table className="w-full text-sm" style={{ minWidth: 820 }}>
                      <thead>
                        <tr className="cd-text-faint text-[11px] border-b cd-border-c">
                          <th className="text-left font-semibold p-2.5">용역명</th>
                          <th className="text-left font-semibold p-2.5">발주처</th>
                          <th className="text-left font-semibold p-2.5">계약일</th>
                          <th className="text-right font-semibold p-2.5">제비용 반영액</th>
                          <th className="text-right font-semibold p-2.5">참여도</th>
                          <th className="text-center font-semibold p-2.5">평점</th>
                          <th className="text-right font-semibold p-2.5">성과급 산정액</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.lines.map((line) => (
                          <tr key={line.contractId} className="border-b cd-border-c last:border-b-0">
                            <td className="p-2.5 cd-text">{line.contractTitle}</td>
                            <td className="p-2.5 cd-text">{line.counterpartyName ?? "-"}</td>
                            <td className="p-2.5 cd-text whitespace-nowrap">{fmtDate(line.contractDate)}</td>
                            <td className="p-2.5 text-right cd-text">{fmtAmount(line.appliedAmount)}</td>
                            <td className="p-2.5 text-right cd-text">{line.participationPct}%</td>
                            <td className="p-2.5 text-center cd-text">
                              {line.grade ?? "-"}
                              {line.gradeWeight != null && (
                                <span className="cd-text-faint text-[10px]"> ×{line.gradeWeight}</span>
                              )}
                            </td>
                            <td className="p-2.5 text-right cd-text font-semibold">{fmtAmount(line.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            ) : !board ? (
              <div className="p-10 text-center text-sm cd-text-faint">데이터가 없습니다.</div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-2xl border cd-border-c p-3">
                    <span className="block text-[11px] cd-text-faint">총 지급대상 기준액</span>
                    <span className="cd-text font-extrabold text-lg">{fmtAmount(board.totalTarget)}원</span>
                  </div>
                  <div className="rounded-2xl border cd-border-c p-3">
                    <span className="block text-[11px] cd-text-faint">영업/지원부서 할당액</span>
                    <span className="cd-text font-extrabold text-lg">{fmtAmount(board.supportQuota)}원</span>
                    <span className={`block text-[11px] ${allocUsed.support > board.supportQuota ? "font-bold" : "cd-text-faint"}`}
                      style={allocUsed.support > board.supportQuota ? { color: "var(--cd-danger, #FA896B)" } : undefined}>
                      배분 {fmtAmount(allocUsed.support)}원 · 잔여 {fmtAmount(board.supportQuota - allocUsed.support)}원
                    </span>
                  </div>
                  <div className="rounded-2xl border cd-border-c p-3">
                    <span className="block text-[11px] cd-text-faint">임원 할당액</span>
                    <span className="cd-text font-extrabold text-lg">{fmtAmount(board.execQuota)}원</span>
                    <span className={`block text-[11px] ${allocUsed.exec > board.execQuota ? "font-bold" : "cd-text-faint"}`}
                      style={allocUsed.exec > board.execQuota ? { color: "var(--cd-danger, #FA896B)" } : undefined}>
                      배분 {fmtAmount(allocUsed.exec)}원 · 잔여 {fmtAmount(board.execQuota - allocUsed.exec)}원
                    </span>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold cd-text-faint mb-1.5">본부장 성과급 (비율 확정)</h4>
                  {board.deptHeads.length === 0 ? (
                    <p className="text-sm cd-text-faint p-3">본부장 비율이 설정된 본부가 없습니다. (지급 대상 LIST에서 설정)</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="cd-text-faint text-[11px] border-b cd-border-c">
                          <th className="text-left font-semibold p-2">본부</th>
                          <th className="text-left font-semibold p-2">본부장(추정)</th>
                          <th className="text-right font-semibold p-2">본부장 비율</th>
                          <th className="text-right font-semibold p-2">산정 성과급</th>
                        </tr>
                      </thead>
                      <tbody>
                        {board.deptHeads.map((d) => (
                          <tr key={d.deptId} className="border-b cd-border-c last:border-b-0">
                            <td className="p-2 cd-text">{d.deptName}</td>
                            <td className="p-2 cd-text">{d.headName ?? <span className="cd-text-faint text-xs">일괄산정 후 표시</span>}</td>
                            <td className="p-2 text-right cd-text">{d.ratePct}%</td>
                            <td className="p-2 text-right cd-text font-semibold">{fmtAmount(d.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div>
                  <h4 className="text-xs font-bold cd-text-faint mb-1.5">개별 배분 (할당액 한도 내, 미만 허용)</h4>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="cd-text-faint text-[11px] border-b cd-border-c">
                        <th className="text-left font-semibold p-2">성명</th>
                        <th className="text-left font-semibold p-2">소속</th>
                        <th className="text-left font-semibold p-2">직함</th>
                        <th className="text-left font-semibold p-2">구분</th>
                        <th className="text-right font-semibold p-2" style={{ width: 160 }}>배분액(원)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.people.map((pn) => (
                        <tr key={pn.employeeId} className="border-b cd-border-c last:border-b-0">
                          <td className="p-2 cd-text">{pn.employeeName}</td>
                          <td className="p-2 cd-text">{pn.deptName ?? "-"}</td>
                          <td className="p-2 cd-text">{pn.positionName ?? "-"}</td>
                          <td className="p-2">
                            <span className="text-[11px] font-semibold rounded-md px-1.5 py-0.5 border cd-border-c cd-text-faint">
                              {BUCKET_LABELS[pn.bucket]}
                            </span>
                          </td>
                          <td className="p-2 text-right">
                            <input
                              type="number" min={0} step={10000}
                              className="cd-input text-sm text-right w-full"
                              disabled={!isAdmin}
                              value={allocDraft[pn.employeeId] ?? pn.amount}
                              onChange={(e) =>
                                setAllocDraft((prev) => ({ ...prev, [pn.employeeId]: Number(e.target.value) }))
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
