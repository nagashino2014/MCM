"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileSearch, Trash2, X } from "lucide-react";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import ContractRoundPanel from "@/components/payroll/ContractRoundPanel";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { OrganizationEmployeeRow, OrganizationSnapshot } from "@/components/admin/users/types";
import type { ContractTreeDept, ContractTreeEmployee, LaborContractCard } from "@/lib/payroll/contracts";

/**
 * 직원별 연봉·근로계약 현황 (PL-P2, UI 컨셉 PDF 재현 — 블루프린트 §4-2)
 * - 좌: 공용 조직도 트리뷰(OrganizationTree, 퇴사자 토글 내장) + 인원 노드 우측 계약 건수 뱃지
 * - 우상: 계약 카드 목록(일반·승진 태그, 다운로드, 검수, 앱 생성 건 삭제)
 * - 우하: 작성/갱신 패널(일괄·개별승진·진행 현황 — PL-P3)
 */

const KIND_LABELS: Record<string, string> = {
  regular: "정규", promotion: "승진", executive: "임원", fixed_term: "기간제",
  advisor: "고문", intern: "인턴", parttime: "아르바이트",
};

function fmt(v: number | null): string {
  return v == null ? "-" : Math.round(v).toLocaleString();
}

export default function LaborContractBoard() {
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [selected, setSelected] = useState<ContractTreeEmployee | null>(null);
  const [contracts, setContracts] = useState<LaborContractCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState<LaborContractCard | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadCounts = useCallback(() => {
    fetch("/api/payroll/contracts", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const map = new Map<string, number>();
        for (const dept of (d.depts ?? []) as ContractTreeDept[]) {
          for (const e of dept.employees) map.set(e.employeeId, e.contractCount);
        }
        for (const e of (d.resigned ?? []) as ContractTreeEmployee[]) map.set(e.employeeId, e.contractCount);
        setCounts(map);
      })
      .catch(() => setCounts(new Map()));
  }, []);

  useEffect(() => {
    loadCounts();
    fetch("/api/organization", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: OrganizationSnapshot | null) => setSnapshot(d))
      .catch(() => setSnapshot(null));
  }, [loadCounts]);

  const loadContracts = useCallback((emp: ContractTreeEmployee) => {
    setSelected(emp);
    setLoading(true);
    fetch(`/api/payroll/contracts?employeeId=${encodeURIComponent(emp.employeeId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setContracts(d.contracts ?? []))
      .catch(() => setContracts([]))
      .finally(() => setLoading(false));
  }, []);

  const reviewCount = useMemo(() => contracts.filter((c) => c.note).length, [contracts]);

  const openReview = (c: LaborContractCard) => {
    setReview(c);
    setDraft({
      contractDate: c.contractDate ?? "",
      effectiveFrom: c.effectiveFrom ?? "",
      effectiveTo: c.effectiveTo ?? "",
      positionName: c.positionName ?? "",
      duty: c.duty ?? "",
      firstHiredAt: c.firstHiredAt ?? "",
      annualSalary: c.annualSalary == null ? "" : String(c.annualSalary),
      monthlySalary: c.monthlySalary == null ? "" : String(c.monthlySalary),
      wageComponents: JSON.stringify(c.wageComponents ?? {}, null, 0),
      tag: c.tag ?? "일반",
    });
  };

  const saveReview = async () => {
    if (!review || !selected) return;
    setSaving(true);
    setMsg(null);
    try {
      let wage: Record<string, number> | undefined;
      try {
        wage = JSON.parse(draft.wageComponents || "{}");
      } catch {
        throw new Error("임금 구성 JSON 형식이 올바르지 않습니다.");
      }
      const res = await fetch(`/api/payroll/contracts/${review.contractId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractDate: draft.contractDate || null,
          effectiveFrom: draft.effectiveFrom || null,
          effectiveTo: draft.effectiveTo || null,
          positionName: draft.positionName || null,
          duty: draft.duty || null,
          firstHiredAt: draft.firstHiredAt || null,
          annualSalary: draft.annualSalary ? Number(draft.annualSalary) : null,
          monthlySalary: draft.monthlySalary ? Number(draft.monthlySalary) : null,
          wageComponents: wage,
          tag: draft.tag || null,
          reviewed: true,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "저장 실패");
      setReview(null);
      loadContracts(selected);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const pickEmployee = useCallback(
    (emp: OrganizationEmployeeRow) => {
      loadContracts({
        employeeId: emp.employeeId,
        name: emp.name,
        positionName: emp.positionName,
        contractCount: counts.get(emp.employeeId) ?? 0,
      });
    },
    [loadContracts, counts]
  );

  const removeContract = async (c: LaborContractCard) => {
    if (!selected) return;
    if (!window.confirm(`${selected.name}의 ${c.contractDate ?? ""} 계약서를 삭제할까요?\n(앱에서 작성된 계약만 삭제되며 되돌릴 수 없습니다)`)) return;
    setMsg(null);
    try {
      const res = await fetch(`/api/payroll/contracts/${c.contractId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "삭제 실패");
      loadContracts(selected);
      loadCounts();
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  return (
    <>
      <CdPageHeader
        title="직원별 연봉·근로계약"
        meta={selected ? `${selected.name} · 계약 ${contracts.length}건${reviewCount ? ` · 검수 필요 ${reviewCount}` : ""}` : undefined}
      />

      <div className="flex flex-1 min-h-0 gap-4">
        {/* 좌: 공용 조직도 트리뷰 — 인원 노드 우측에 계약 건수 뱃지, 퇴사자 토글 내장 */}
        <aside className="w-80 shrink-0 min-h-0 cd-reveal">
          <OrganizationTree
            snapshot={snapshot}
            fillHeight
            allowResignedView
            selectedEmployeeId={selected?.employeeId ?? null}
            onSelectEmployee={pickEmployee}
            employeeBadge={(e) => counts.get(e.employeeId) ?? 0}
            hideDeptCount
          />
        </aside>

        {/* 우: 카드 목록 + 작성 패널 */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          <section className="cd-card rounded-3xl flex-1 min-h-0 flex flex-col p-4 cd-reveal delay-1">
            <h2 className="text-[15px] font-extrabold tracking-tight cd-text mb-2.5">
              근로계약서 작성/갱신 이력
            </h2>
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide flex flex-col gap-2.5">
              {!selected && <p className="p-4 text-sm cd-text-faint">좌측에서 직원을 선택하세요.</p>}
              {selected && loading && <p className="p-4 text-sm cd-text-faint">불러오는 중…</p>}
              {selected && !loading && !contracts.length && (
                <p className="p-4 text-sm cd-text-faint">등록된 계약이 없습니다.</p>
              )}
              {contracts.map((c) => (
                <div key={c.contractId} className="border cd-border-c rounded-2xl px-4 py-3 flex items-center gap-3">
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold"
                    style={
                      c.tag === "승진"
                        ? { color: "var(--cd-warning)", background: "var(--cd-warning-soft)" }
                        : { color: "var(--cd-primary)", background: "var(--cd-primary-soft)" }
                    }
                  >
                    {c.tag ?? "일반"}
                  </span>
                  <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-0.5 text-sm">
                    <div>
                      <p className="text-[11px] cd-text-faint">작성/갱신일</p>
                      <p className="cd-text font-semibold">{c.contractDate ?? "-"}</p>
                    </div>
                    <div>
                      <p className="text-[11px] cd-text-faint">직급 · 구분</p>
                      <p className="cd-text font-semibold">
                        {c.positionName ?? "-"}
                        <span className="ml-1 text-[11px] cd-text-faint">{KIND_LABELS[c.kind] ?? c.kind}</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] cd-text-faint">연봉총액 (기본급)</p>
                      <p className="cd-text font-semibold tabular-nums">
                        {fmt(c.annualSalary)}
                        <span className="ml-1 text-[11px] cd-text-faint">({fmt(c.wageComponents?.["기본급"] ?? null)})</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] cd-text-faint">연봉계약 기간</p>
                      <p className="cd-text font-semibold">
                        {c.effectiveFrom ? `${c.effectiveFrom} ~ ${c.effectiveTo ?? ""}` : "-"}
                      </p>
                    </div>
                  </div>
                  {c.note && (
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ color: "var(--cd-error)", background: "var(--cd-error-soft)" }} title={c.note}>
                      검수 필요
                    </span>
                  )}
                  <button type="button" className="cd-btn rounded-xl p-2" title="추출값 검토" onClick={() => openReview(c)}>
                    <FileSearch className="w-4 h-4" />
                  </button>
                  {c.hasFile && (
                    <a className="cd-btn rounded-xl p-2" title="계약서 PDF" href={`/api/payroll/contracts/${c.contractId}/file`} target="_blank" rel="noreferrer">
                      <Download className="w-4 h-4" />
                    </a>
                  )}
                  {c.source === "generated" && c.status !== "signed" && (
                    <button
                      type="button"
                      className="cd-btn rounded-xl p-2"
                      title="계약서 삭제(앱 작성분)"
                      style={{ color: "var(--cd-error)" }}
                      onClick={() => removeContract(c)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* 작성/갱신 패널 (PL-P3) */}
          <ContractRoundPanel
            selected={selected ? { employeeId: selected.employeeId, name: selected.name } : null}
            onChanged={() => {
              if (selected) loadContracts(selected);
              loadCounts();
            }}
          />
        </div>
      </div>

      {/* 검수 모달 — 원본 PDF 나란히 */}
      {review && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-6" onClick={() => setReview(null)}>
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }} />
          <div
            className="cd-solid-bg relative z-10 w-full max-w-5xl h-[86vh] rounded-3xl p-5 flex gap-4"
            style={{ boxShadow: "var(--cd-shadow)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 min-w-0 rounded-2xl overflow-hidden border cd-border-c">
              {review.hasFile ? (
                <iframe title="계약서 원본" src={`/api/payroll/contracts/${review.contractId}/file`} className="w-full h-full" />
              ) : (
                <p className="p-4 text-sm cd-text-faint">원본 파일이 없습니다.</p>
              )}
            </div>
            <div className="w-80 shrink-0 flex flex-col gap-2 overflow-y-auto">
              <div className="flex items-start justify-between">
                <h3 className="text-base font-extrabold cd-text">추출값 검토</h3>
                <button type="button" className="cd-btn rounded-xl p-1.5" onClick={() => setReview(null)} aria-label="닫기">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {review.note && (
                <p className="text-[11px] rounded-xl p-2.5" style={{ color: "var(--cd-warning)", background: "var(--cd-warning-soft)" }}>
                  {review.note}
                </p>
              )}
              {(
                [
                  ["contractDate", "작성일 (YYYY-MM-DD)"],
                  ["firstHiredAt", "최초입사일"],
                  ["effectiveFrom", "연봉계약 시작"],
                  ["effectiveTo", "연봉계약 종료"],
                  ["positionName", "직위"],
                  ["duty", "담당 업무"],
                  ["annualSalary", "연봉총액(원)"],
                  ["monthlySalary", "월 급여(원)"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="text-xs cd-text-faint">
                  {label}
                  <input
                    className="cd-input text-sm w-full mt-0.5"
                    value={draft[key] ?? ""}
                    onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.value }))}
                  />
                </label>
              ))}
              <label className="text-xs cd-text-faint">
                월 임금 구성(JSON)
                <textarea
                  className="cd-input text-xs w-full mt-0.5 font-mono"
                  rows={4}
                  value={draft.wageComponents ?? ""}
                  onChange={(e) => setDraft((p) => ({ ...p, wageComponents: e.target.value }))}
                />
              </label>
              <label className="text-xs cd-text-faint">
                태그
                <select
                  className="cd-select text-sm w-full mt-0.5"
                  value={draft.tag ?? "일반"}
                  onChange={(e) => setDraft((p) => ({ ...p, tag: e.target.value }))}
                >
                  <option value="일반">일반</option>
                  <option value="승진">승진</option>
                </select>
              </label>
              {msg && <p className="text-xs" style={{ color: "var(--cd-error)" }}>{msg}</p>}
              <button
                type="button"
                disabled={saving}
                onClick={saveReview}
                className="cd-fill-primary text-white rounded-xl px-3.5 py-2 text-sm font-semibold disabled:opacity-50 mt-1"
              >
                검수 완료로 저장
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
