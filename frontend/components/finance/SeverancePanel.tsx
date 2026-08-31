"use client";

// 퇴직 정산(FRM-P5, 207) — 퇴사자별 정산 카드. 연차수당은 연차수당 지급 신청서 승인 시 자동 기입,
// 퇴직금은 수기 입력(자동 산정은 후속 블루프린트). 정산 완료 처리로 마감한다.

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Save } from "lucide-react";

interface SeveranceRow {
  settleId: string;
  employeeId: string;
  employeeName: string | null;
  deptName: string | null;
  resignDate: string | null;
  leavePayDays: number | null;
  leavePayAmount: number | null;
  leavePayDocNo: string | null;
  severanceAmount: number | null;
  status: string;
  note: string | null;
  updatedAt: string;
}

const won = (n: number | null) => (n != null ? n.toLocaleString("ko-KR") : "-");

export function SeverancePanel() {
  const [rows, setRows] = useState<SeveranceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { severanceAmount: string; note: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/finance/severance", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "조회 실패");
      setRows(Array.isArray(data.settlements) ? data.settlements : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const editOf = (r: SeveranceRow) =>
    edits[r.settleId] ?? { severanceAmount: r.severanceAmount != null ? String(r.severanceAmount) : "", note: r.note ?? "" };

  const save = async (r: SeveranceRow, status?: "confirmed" | "draft") => {
    const edit = editOf(r);
    setBusy(r.settleId);
    try {
      const res = await fetch("/api/finance/severance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settleId: r.settleId,
          severanceAmount: edit.severanceAmount.trim() ? Number(edit.severanceAmount.replace(/[^\d]/g, "")) : null,
          note: edit.note.trim() || null,
          ...(status ? { status } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      setRows(Array.isArray(data.settlements) ? data.settlements : []);
      setEdits((prev) => {
        const next = { ...prev };
        delete next[r.settleId];
        return next;
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  return (
    <div className="cd-card p-4">
      <div className="cd-card-title mb-1">퇴직 정산</div>
      <div className="text-xs cd-text-muted mb-3">
        연차수당 지급 신청서가 승인되면 대상자 카드가 자동 생성되고 지급 대상액이 기입됩니다. 퇴직금은 수기 입력(자동 산정·퇴직소득세는 후속 구축),
        지급을 마치면 [정산 완료]로 마감하세요.
      </div>
      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="cd-text-muted text-left">
              <th className="py-1.5 pr-3 font-normal">퇴사자</th>
              <th className="py-1.5 pr-3 font-normal">부서</th>
              <th className="py-1.5 pr-3 font-normal">퇴사일</th>
              <th className="py-1.5 pr-3 font-normal text-right">연차수당(잔여일수)</th>
              <th className="py-1.5 pr-3 font-normal">근거 문서</th>
              <th className="py-1.5 pr-3 font-normal text-right">퇴직금(수기)</th>
              <th className="py-1.5 pr-3 font-normal">메모</th>
              <th className="py-1.5 font-normal">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const edit = editOf(r);
              const confirmed = r.status === "confirmed";
              return (
                <tr key={r.settleId} className="border-t cd-hairline-row-c align-middle">
                  <td className="py-2 pr-3 whitespace-nowrap font-medium">{r.employeeName ?? r.employeeId}</td>
                  <td className="py-2 pr-3 whitespace-nowrap cd-text-muted">{r.deptName ?? "-"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{r.resignDate ?? "-"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-right">
                    {won(r.leavePayAmount)}
                    {r.leavePayDays != null && <span className="cd-text-muted text-xs"> ({r.leavePayDays}일)</span>}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-xs cd-text-muted">{r.leavePayDocNo ?? "-"}</td>
                  <td className="py-2 pr-3 text-right">
                    <input
                      className="cd-input text-right"
                      style={{ width: 120 }}
                      inputMode="numeric"
                      disabled={confirmed}
                      value={edit.severanceAmount}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [r.settleId]: { ...edit, severanceAmount: e.target.value.replace(/[^\d]/g, "") } }))}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      className="cd-input w-full min-w-[140px]"
                      disabled={confirmed}
                      value={edit.note}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [r.settleId]: { ...edit, note: e.target.value } }))}
                    />
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {confirmed ? (
                        <>
                          <span className="cd-pill cd-pill-info">정산 완료</span>
                          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy === r.settleId} onClick={() => void save(r, "draft")}>
                            되돌리기
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy === r.settleId} onClick={() => void save(r)}>
                            <Save className="w-3.5 h-3.5" /> 저장
                          </button>
                          <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={busy === r.settleId} onClick={() => void save(r, "confirmed")}>
                            <CheckCircle2 className="w-3.5 h-3.5" /> 정산 완료
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center cd-text-muted text-sm">퇴직 정산 대상이 없습니다 — 연차수당 지급 신청서가 승인되면 자동 생성됩니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
