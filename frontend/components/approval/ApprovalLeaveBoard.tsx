"use client";

// 연차 대장(/approval/leave, admin) — 직원별 부여/사용/잔여 + 엔트리 내역 + 부여/조정 입력.
// 사용(use)은 휴가신청 승인 시 자동 적재(연차 1일·반차 0.5일). 초기 잔여는 일괄 등록으로 임포트.
// 설계: docs/e-approval-blueprint.md §8-5.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck2, ChevronDown, ChevronRight, ClipboardPaste, Plus, Trash2, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";

interface SummaryRow {
  employeeId: string;
  name: string;
  deptName: string | null;
  positionName: string | null;
  granted: number;
  used: number;
  remaining: number;
}

interface EntryRow {
  entryId: string;
  entryType: string;
  days: number;
  docId: string | null;
  note: string | null;
  createdAt: string;
}

const ENTRY_LABEL: Record<string, string> = { grant: "부여", use: "사용", adjust: "조정" };
const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function ApprovalLeaveBoard() {
  const { theme } = useCdashTheme();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, EntryRow[]>>({});
  // 개별 추가 폼
  const [addEmp, setAddEmp] = useState("");
  const [addType, setAddType] = useState<"grant" | "adjust">("grant");
  const [addDays, setAddDays] = useState("");
  const [addNote, setAddNote] = useState("");
  const [busy, setBusy] = useState(false);
  // 일괄 등록 모달
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/approval/leave?year=${year}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "연차 대장을 불러오지 못했습니다.");
      setRows(data.rows ?? []);
      setEntries({});
      setExpanded(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [year]);
  useEffect(() => {
    load();
  }, [load]);

  const toggleExpand = async (employeeId: string) => {
    if (expanded === employeeId) {
      setExpanded(null);
      return;
    }
    setExpanded(employeeId);
    if (!entries[employeeId]) {
      try {
        const res = await fetch(`/api/approval/leave?year=${year}&employeeId=${encodeURIComponent(employeeId)}`, { cache: "no-store" });
        const data = await res.json();
        if (res.ok) setEntries((prev) => ({ ...prev, [employeeId]: data.entries ?? [] }));
      } catch {
        // 무시
      }
    }
  };

  const post = async (payload: unknown): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await fetch("/api/approval/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      await load();
      return true;
    } catch (err) {
      alert((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addOne = async () => {
    const days = Number(addDays);
    if (!addEmp || !isFinite(days) || days === 0) {
      alert("직원과 일수를 입력하세요.");
      return;
    }
    const ok = await post({ entries: [{ employeeId: addEmp, year, entryType: addType, days, note: addNote || null }] });
    if (ok) {
      setAddDays("");
      setAddNote("");
    }
  };

  // 일괄 등록 파싱 — "이름[탭|콤마|공백]일수" 줄 단위, 이름은 요약 행에서 매칭(동명이인 오류)
  const bulkParsed = useMemo(() => {
    const byName = new Map<string, SummaryRow[]>();
    for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
    return bulkText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.split(/[\t,]|\s{1,}/).filter(Boolean);
        const name = m[0] ?? "";
        const days = Number(m[1]);
        const matches = byName.get(name) ?? [];
        return {
          name,
          days,
          employeeId: matches.length === 1 ? matches[0].employeeId : null,
          error: !name || !isFinite(days) || days <= 0 ? "형식 오류" : matches.length === 0 ? "직원 없음" : matches.length > 1 ? "동명이인" : null,
        };
      });
  }, [bulkText, rows]);

  const bulkSubmit = async () => {
    const valid = bulkParsed.filter((p) => !p.error && p.employeeId);
    if (!valid.length) {
      alert("등록할 유효한 줄이 없습니다.");
      return;
    }
    const ok = await post({
      entries: valid.map((p) => ({ employeeId: p.employeeId!, year, entryType: "grant" as const, days: p.days, note: `${year}년 연차 부여(일괄)` })),
    });
    if (ok) {
      setBulkModal(false);
      setBulkText("");
    }
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<CalendarCheck2 className="w-5 h-5" />}
        eyebrow="Approval · Leave"
        title="연차 대장"
        subtitle="직원별 연차 부여·사용·잔여를 관리합니다. 사용은 휴가신청 승인 시 자동 반영됩니다(연차 1일 · 반차 0.5일)."
        actions={
          <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5" onClick={() => setBulkModal(true)}>
            <ClipboardPaste className="w-3.5 h-3.5" /> 일괄 등록(붙여넣기)
          </button>
        }
      />
      {error && <p className="text-sm text-[color:var(--cd-danger,#FA896B)]">{error}</p>}

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <select className="cd-select" style={{ width: 110 }} value={year} onChange={(e) => setYear(e.target.value)}>
            {Array.from({ length: 4 }, (_, i) => String(thisYear + 1 - i)).map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
          {/* 개별 부여/조정 */}
          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            <select className="cd-select" style={{ width: 150 }} value={addEmp} onChange={(e) => setAddEmp(e.target.value)}>
              <option value="">직원 선택</option>
              {rows.map((r) => (
                <option key={r.employeeId} value={r.employeeId}>
                  {r.name}
                  {r.positionName ? ` ${r.positionName}` : ""}
                </option>
              ))}
            </select>
            <select className="cd-select" style={{ width: 76 }} value={addType} onChange={(e) => setAddType(e.target.value as "grant" | "adjust")}>
              <option value="grant">부여</option>
              <option value="adjust">조정(±)</option>
            </select>
            <input className="cd-input" style={{ width: 76 }} placeholder="일수" inputMode="decimal" value={addDays} onChange={(e) => setAddDays(e.target.value)} />
            <input className="cd-input" style={{ width: 170 }} placeholder="메모(선택)" value={addNote} onChange={(e) => setAddNote(e.target.value)} />
            <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy} onClick={addOne}>
              <Plus className="w-3.5 h-3.5 inline" /> 추가
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left cd-text-faint text-[11px]">
                  <th className="py-1.5 pr-3 font-semibold w-6" />
                  <th className="py-1.5 pr-3 font-semibold">이름</th>
                  <th className="py-1.5 pr-3 font-semibold">부서</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">부여</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">사용</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">잔여</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RowBlock
                    key={r.employeeId}
                    row={r}
                    expanded={expanded === r.employeeId}
                    entries={entries[r.employeeId]}
                    onToggle={() => toggleExpand(r.employeeId)}
                    onDeleteEntry={async (entryId) => {
                      if (!confirm("이 엔트리를 삭제할까요?")) return;
                      const ok = await post({ deleteEntryId: entryId });
                      if (ok) setEntries((prev) => ({ ...prev, [r.employeeId]: (prev[r.employeeId] ?? []).filter((e) => e.entryId !== entryId) }));
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[10.5px] cd-text-faint">
          부여·조정 엔트리는 수동 입력(초기 임포트 포함), 사용 엔트리는 휴가신청 승인 시 자동 적재됩니다. 행을 클릭하면 내역이 펼쳐집니다.
        </p>
      </div>

      {/* 일괄 등록 모달 */}
      {bulkModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setBulkModal(false)}>
          <div
            className="cdash cdash-vars cd-fields-white cd-card-bg rounded-2xl border cd-border-c w-full max-w-lg max-h-[85vh] overflow-y-auto p-4 flex flex-col gap-3"
            data-theme={theme}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-bold cd-text flex-1">{year}년 연차 일괄 부여</h3>
              <button type="button" className="cd-btn cd-btn-soft text-[12px]" onClick={() => setBulkModal(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11.5px] cd-text-faint">
              엑셀에서 "이름·일수" 두 열을 복사해 붙여넣으세요(줄당 1명). 예: <span className="font-mono">홍길동 15</span>
            </p>
            <textarea className="cd-input min-h-[160px] font-mono text-[12px]" value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={"홍길동\t15\n김철수\t17.5"} />
            {bulkParsed.length > 0 && (
              <div className="rounded-xl border cd-border-c p-2.5 max-h-40 overflow-y-auto text-[11.5px]">
                {bulkParsed.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="cd-text w-24 truncate">{p.name}</span>
                    <span className="cd-text-faint">{isFinite(p.days) ? `${p.days}일` : "-"}</span>
                    {p.error ? (
                      <span className="text-[color:var(--cd-danger,#FA896B)] ml-auto">{p.error}</span>
                    ) : (
                      <span className="text-[color:var(--cd-success,#13DEB9)] ml-auto">확인</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50 self-end" disabled={busy} onClick={bulkSubmit}>
              {bulkParsed.filter((p) => !p.error).length}명 부여 등록
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RowBlock({
  row: r,
  expanded,
  entries,
  onToggle,
  onDeleteEntry,
}: {
  row: SummaryRow;
  expanded: boolean;
  entries?: EntryRow[];
  onToggle: () => void;
  onDeleteEntry: (entryId: string) => void;
}) {
  return (
    <>
      <tr className="border-t cd-border-c cursor-pointer hover:bg-[color:var(--cd-surface)]" onClick={onToggle}>
        <td className="py-2 pr-1 cd-text-faint">{expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
        <td className="py-2 pr-3 cd-text font-semibold">
          {r.name}
          {r.positionName && <span className="cd-text-faint font-normal text-[11px]"> {r.positionName}</span>}
        </td>
        <td className="py-2 pr-3 cd-text-faint">{r.deptName ?? "-"}</td>
        <td className="py-2 pr-3 text-right font-mono">{fmtDays(r.granted)}</td>
        <td className="py-2 pr-3 text-right font-mono">{fmtDays(r.used)}</td>
        <td className={`py-2 pr-3 text-right font-mono font-bold ${r.remaining < 0 ? "text-[color:var(--cd-danger,#FA896B)]" : "cd-text"}`}>
          {fmtDays(r.remaining)}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t cd-border-c">
          <td />
          <td colSpan={5} className="py-2">
            {!entries ? (
              <p className="text-[11.5px] cd-text-faint">내역을 불러오는 중입니다.</p>
            ) : entries.length === 0 ? (
              <p className="text-[11.5px] cd-text-faint">엔트리가 없습니다.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {entries.map((e) => (
                  <div key={e.entryId} className="flex items-center gap-2 text-[11.5px]">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        e.entryType === "use" ? "cd-tint-primary" : "border cd-border-c cd-text-faint"
                      }`}
                    >
                      {ENTRY_LABEL[e.entryType] ?? e.entryType}
                    </span>
                    <span className="font-mono cd-text">{fmtDays(e.days)}일</span>
                    <span className="cd-text-faint truncate">{e.note ?? ""}</span>
                    <span className="cd-text-faint font-mono text-[10.5px] ml-auto shrink-0">{e.createdAt.slice(0, 10)}</span>
                    <button
                      type="button"
                      className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)] shrink-0"
                      title="엔트리 삭제"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onDeleteEntry(e.entryId);
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
