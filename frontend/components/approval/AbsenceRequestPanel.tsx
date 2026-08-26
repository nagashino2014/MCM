"use client";

// 결근사유서 제출 요청 관리(FRM-P1, 202) — 근태 관리 탭. 관리자가 결근자·기간을 지정해 요청하면
// 대상자 기안 화면(결근사유서 양식)에 배너로 노출되고, 상신 시 커넥터가 요청을 자동 마감한다.

import { useCallback, useEffect, useState } from "react";
import { Send, Trash2, UserRoundSearch } from "lucide-react";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import { OrgPickerModal } from "@/components/approval/OrgPickerModal";

interface RequestRow {
  requestId: string;
  employeeId: string;
  employeeName: string | null;
  deptName: string | null;
  dateFrom: string;
  dateTo: string;
  note: string | null;
  status: string;
  docNo: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = { pending: "대기", submitted: "제출됨", canceled: "취소" };

export function AbsenceRequestPanel() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [orgModal, setOrgModal] = useState(false);
  const [target, setTarget] = useState<{ employeeId: string; name: string } | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/approval/absence-requests", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "조회 실패");
      setRows(Array.isArray(data.requests) ? data.requests : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!target || !dateFrom) return;
    setBusy(true);
    try {
      const res = await fetch("/api/approval/absence-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: target.employeeId, dateFrom, dateTo: dateTo || null, note: note.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "요청 생성 실패");
      setTarget(null);
      setDateFrom("");
      setDateTo("");
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const cancel = async (requestId: string) => {
    if (!confirm("이 제출 요청을 취소할까요?")) return;
    await fetch(`/api/approval/absence-requests?requestId=${encodeURIComponent(requestId)}`, { method: "DELETE" }).catch(() => {});
    await load();
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 요청 생성 */}
      <div className="cd-card border cd-border-c p-4 flex flex-col gap-3">
        <p className="text-[13px] font-bold cd-text">결근사유서 제출 요청 보내기</p>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => setOrgModal(true)}>
            <UserRoundSearch className="w-3.5 h-3.5" /> {target ? target.name : "대상자 선택"}
          </button>
          <AutoDateInput className="cd-input" style={{ width: 120 }} value={dateFrom} onChange={setDateFrom} />
          <span className="text-[12px] cd-text-faint">~</span>
          <AutoDateInput className="cd-input" style={{ width: 120 }} value={dateTo} onChange={setDateTo} />
          <input
            type="text"
            className="cd-input flex-1 min-w-[180px]"
            placeholder="메모(대상자에게 표시 — 예: 8/12 무단결근 소명 요청)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={busy || !target || !dateFrom} onClick={() => void create()}>
            <Send className="w-3.5 h-3.5" /> 요청 보내기
          </button>
        </div>
        <p className="text-[11px] cd-text-faint">
          요청을 받은 인원의 결근사유서 기안 화면에 안내 배너가 표시되고, 상신하면 요청이 자동으로 마감됩니다. 종료일을 비우면 하루 결근으로 처리합니다.
        </p>
        {error && <p className="text-[12px]" style={{ color: "var(--cd-error,#FA896B)" }}>{error}</p>}
      </div>

      {/* 요청 목록 */}
      <div className="cd-card border cd-border-c p-0 overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              {["대상", "부서", "결근 기간", "메모", "상태", "제출 문서", "요청일", ""].map((h) => (
                <th key={h} className="px-3 py-2 text-left cd-surface-bg cd-text font-bold whitespace-nowrap border-b cd-border-c">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center cd-text-faint">불러오는 중…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center cd-text-faint">요청 내역이 없습니다.</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.requestId} className="border-b cd-border-c last:border-b-0">
                  <td className="px-3 py-2 cd-text whitespace-nowrap">{r.employeeName ?? r.employeeId}</td>
                  <td className="px-3 py-2 cd-text-muted whitespace-nowrap">{r.deptName ?? "-"}</td>
                  <td className="px-3 py-2 cd-text whitespace-nowrap">
                    {r.dateFrom}
                    {r.dateTo !== r.dateFrom ? ` ~ ${r.dateTo}` : ""}
                  </td>
                  <td className="px-3 py-2 cd-text-muted">{r.note ?? "-"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className="cd-chip"
                      style={r.status === "pending" ? { color: "var(--cd-warning,#FFAE1F)" } : undefined}
                    >
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 cd-text-muted whitespace-nowrap">{r.docNo ?? "-"}</td>
                  <td className="px-3 py-2 cd-text-faint whitespace-nowrap">{r.createdAt.slice(0, 10)}</td>
                  <td className="px-3 py-2 text-right">
                    {r.status === "pending" && (
                      <button
                        type="button"
                        className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]"
                        title="요청 취소"
                        onClick={() => void cancel(r.requestId)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <OrgPickerModal
        open={orgModal}
        title="결근사유서 요청 대상 — 조직도에서 선택"
        hint="인원을 클릭하면 선택됩니다."
        onClose={() => setOrgModal(false)}
        onSelect={(emp) => {
          setTarget({ employeeId: emp.employeeId, name: emp.name });
          setOrgModal(false);
        }}
      />
    </div>
  );
}
