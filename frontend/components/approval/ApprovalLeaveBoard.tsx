"use client";

// 직원별 휴가 관리(/approval/leave, admin) — 연차 + 연차 외 모든 휴가를 날짜별 이력으로 관리.
// 사용 이력은 휴가신청 승인 시 자동 적재되고, 관리자가 직접 추가/수정/삭제(초기값 보정)한다.
// 연차 발생 기준(회계연도 1/1 / 입사일) 전환 옵션. KPI·차트는 LM-P4.
// 설계: docs/leave-management-blueprint.md §3·§4.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck2, ChevronDown, ChevronRight, ClipboardPaste, Plus, Trash2, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { EmployeeAvatar } from "@/components/ui/EmployeeAvatar";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import type { LeaveTypeItem } from "@/lib/approval/leave-types";
import type { AccrualBasis } from "@/lib/approval/leave-accrual";
import "@/components/cdash/cdash.css";

interface SummaryRow {
  employeeId: string;
  name: string;
  deptName: string | null;
  positionName: string | null;
  hiredAt: string | null;
  photoPath: string | null;
  granted: number;
  usedAnnual: number;
  remaining: number;
  otherUsed: number;
  accrual: number | null;
}

interface EntryRow {
  entryId: string;
  entryType: string; // grant|use|adjust
  days: number;
  usedOn: string | null;
  leaveTypeKey: string | null;
  leaveLabel: string | null;
  deduct: "full" | "half" | null;
  note: string | null;
}

const ENTRY_LABEL: Record<string, string> = { grant: "부여", use: "사용", adjust: "조정" };
const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function ApprovalLeaveBoard() {
  const { theme } = useCdashTheme();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [basis, setBasis] = useState<AccrualBasis>("jan1");
  const [catalog, setCatalog] = useState<LeaveTypeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, EntryRow[]>>({});
  const [busy, setBusy] = useState(false);
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState("");
  // 사용 이력 추가 폼(직원별)
  const [addForm, setAddForm] = useState<{ usedOn: string; typeKey: string; days: string; note: string }>({ usedOn: "", typeKey: "annual", days: "1", note: "" });
  // 부여/조정 폼
  const [grantForm, setGrantForm] = useState<{ type: "grant" | "adjust"; days: string; note: string }>({ type: "grant", days: "", note: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, cat] = await Promise.all([
        fetch(`/api/approval/leave?year=${year}`, { cache: "no-store" }),
        fetch("/api/approval/leave-types", { cache: "no-store" }),
      ]);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "휴가 현황을 불러오지 못했습니다.");
      setRows(data.rows ?? []);
      if (data.settings?.accrualBasis) setBasis(data.settings.accrualBasis);
      if (cat.ok) {
        const cd = await cat.json();
        setCatalog(cd.types ?? []);
      }
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

  const loadEntries = useCallback(
    async (employeeId: string) => {
      const res = await fetch(`/api/approval/leave?year=${year}&employeeId=${encodeURIComponent(employeeId)}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setEntries((prev) => ({ ...prev, [employeeId]: data.entries ?? [] }));
    },
    [year]
  );

  const toggleExpand = async (employeeId: string) => {
    if (expanded === employeeId) {
      setExpanded(null);
      return;
    }
    setExpanded(employeeId);
    setAddForm({ usedOn: "", typeKey: "annual", days: "1", note: "" });
    setGrantForm({ type: "grant", days: "", note: "" });
    if (!entries[employeeId]) await loadEntries(employeeId);
  };

  const post = async (payload: unknown): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await fetch("/api/approval/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      return true;
    } catch (err) {
      alert((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const changeBasis = async (next: AccrualBasis) => {
    setBasis(next);
    const ok = await post({ accrualBasis: next });
    if (ok) await load();
  };

  const addUsage = async (employeeId: string) => {
    if (!addForm.usedOn || !addForm.typeKey || !(Number(addForm.days) > 0)) {
      alert("사용일·종류·일수를 입력하세요.");
      return;
    }
    const ok = await post({ usage: { employeeId, usedOn: addForm.usedOn, leaveTypeKey: addForm.typeKey, days: Number(addForm.days), note: addForm.note || null } });
    if (ok) {
      setAddForm({ usedOn: "", typeKey: addForm.typeKey, days: "1", note: "" });
      await loadEntries(employeeId);
      await load();
    }
  };

  const addGrant = async (employeeId: string) => {
    const days = Number(grantForm.days);
    if (!isFinite(days) || days === 0) {
      alert("일수를 입력하세요.");
      return;
    }
    const ok = await post({ entries: [{ employeeId, year, entryType: grantForm.type, days, note: grantForm.note || null }] });
    if (ok) {
      setGrantForm({ type: grantForm.type, days: "", note: "" });
      await loadEntries(employeeId);
      await load();
    }
  };

  const removeEntry = async (employeeId: string, entryId: string) => {
    if (!confirm("이 엔트리를 삭제할까요?")) return;
    const ok = await post({ deleteEntryId: entryId });
    if (ok) {
      await loadEntries(employeeId);
      await load();
    }
  };

  const updateUsageDays = async (employeeId: string, e: EntryRow, days: number) => {
    if (!(days > 0) || !e.usedOn || !e.leaveTypeKey) return;
    const ok = await post({ usage: { entryId: e.entryId, employeeId, usedOn: e.usedOn, leaveTypeKey: e.leaveTypeKey, days, note: e.note } });
    if (ok) {
      await loadEntries(employeeId);
      await load();
    }
  };

  // 일괄 등록(연차 부여) — "이름 일수" 붙여넣기
  const bulkParsed = useMemo(() => {
    const byName = new Map<string, SummaryRow[]>();
    for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
    return bulkText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.split(/[\t,]|\s{1,}/).filter(Boolean);
        const name = m[0] ?? "";
        const days = Number(m[1]);
        const matches = byName.get(name) ?? [];
        return { name, days, employeeId: matches.length === 1 ? matches[0].employeeId : null, error: !name || !isFinite(days) || days <= 0 ? "형식 오류" : matches.length === 0 ? "직원 없음" : matches.length > 1 ? "동명이인" : null };
      });
  }, [bulkText, rows]);

  const bulkSubmit = async () => {
    const valid = bulkParsed.filter((p) => !p.error && p.employeeId);
    if (!valid.length) {
      alert("등록할 유효한 줄이 없습니다.");
      return;
    }
    const ok = await post({ entries: valid.map((p) => ({ employeeId: p.employeeId!, year, entryType: "grant" as const, days: p.days, note: `${year}년 연차 부여(일괄)` })) });
    if (ok) {
      setBulkModal(false);
      setBulkText("");
      await load();
    }
  };

  // KPI 요약(전사 평균) — LM-P4 차트 전 간단 표시
  const kpi = useMemo(() => {
    if (!rows.length) return null;
    const n = rows.length;
    const sum = rows.reduce((a, r) => ({ g: a.g + r.granted, u: a.u + r.usedAnnual, o: a.o + r.otherUsed }), { g: 0, u: 0, o: 0 });
    return { granted: sum.g / n, used: sum.u / n, rate: sum.g > 0 ? (sum.u / sum.g) * 100 : 0, other: sum.o / n };
  }, [rows]);

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<CalendarCheck2 className="w-5 h-5" />}
        eyebrow="Approval · Leave"
        title="직원별 휴가 관리"
        subtitle="연차와 연차 외 휴가(경조·공가·병가)를 날짜별 이력으로 관리합니다. 사용은 휴가신청 승인 시 자동 반영되며 직접 보정할 수 있습니다."
        actions={
          <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5" onClick={() => setBulkModal(true)}>
            <ClipboardPaste className="w-3.5 h-3.5" /> 연차 일괄 등록
          </button>
        }
      />
      {error && <p className="text-sm text-[color:var(--cd-danger,#FA896B)]">{error}</p>}

      {/* 간이 KPI (LM-P4에서 차트로 확장) */}
      {kpi && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ["평균 연차 부여", `${kpi.granted.toFixed(1)}일`],
            ["평균 연차 사용", `${kpi.used.toFixed(1)}일`],
            ["평균 연차 소진율", `${kpi.rate.toFixed(0)}%`],
            ["평균 연차 외 휴가", `${kpi.other.toFixed(1)}일`],
          ].map(([l, v]) => (
            <div key={l} className="cd-card rounded-2xl p-4">
              <div className="text-[11px] cd-text-faint">{l}</div>
              <div className="text-2xl font-extrabold cd-text mt-1 tabular-nums">{v}</div>
            </div>
          ))}
        </div>
      )}

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <select className="cd-select" style={{ width: 110 }} value={year} onChange={(e) => setYear(e.target.value)}>
            {Array.from({ length: 4 }, (_, i) => String(thisYear + 1 - i)).map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-1.5 text-[11.5px] cd-text-faint">
            연차 발생 기준
            <select className="cd-select" style={{ width: 150 }} value={basis} onChange={(e) => changeBasis(e.target.value as AccrualBasis)}>
              <option value="jan1">회계연도(매년 1/1)</option>
              <option value="hire_date">입사일 기준</option>
            </select>
          </div>
        </div>

        {loading ? (
          <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left cd-text-faint text-[11px]">
                  <th className="py-1.5 pr-2 font-semibold w-6" />
                  <th className="py-1.5 pr-3 font-semibold">직원</th>
                  <th className="py-1.5 pr-3 font-semibold">부서</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">부여</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">사용</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">잔여</th>
                  <th className="py-1.5 pr-3 font-semibold text-right" title="규정상 발생연차(참고)">규정 발생</th>
                  <th className="py-1.5 font-semibold text-right">연차 외 사용</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RowBlock
                    key={r.employeeId}
                    row={r}
                    expanded={expanded === r.employeeId}
                    entries={entries[r.employeeId]}
                    catalog={catalog}
                    addForm={addForm}
                    setAddForm={setAddForm}
                    grantForm={grantForm}
                    setGrantForm={setGrantForm}
                    busy={busy}
                    onToggle={() => toggleExpand(r.employeeId)}
                    onAddUsage={() => addUsage(r.employeeId)}
                    onAddGrant={() => addGrant(r.employeeId)}
                    onDelete={(entryId) => removeEntry(r.employeeId, entryId)}
                    onUpdateDays={(e, days) => updateUsageDays(r.employeeId, e, days)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[10.5px] cd-text-faint">
          행을 클릭하면 날짜별 휴가 이력이 펼쳐집니다. 사용 이력·부여/조정은 직접 추가·수정·삭제할 수 있습니다(초기값 보정).
          &apos;규정 발생&apos;은 근로기준법 기준 자동 계산값(참고)이며 실제 부여는 대장 기준입니다.
        </p>
      </div>

      {/* 일괄 등록 모달 */}
      {bulkModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setBulkModal(false)}>
          <div className="cdash cdash-vars cd-fields-white cd-card-bg rounded-2xl border cd-border-c w-full max-w-lg max-h-[85vh] overflow-y-auto p-4 flex flex-col gap-3" data-theme={theme} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-bold cd-text flex-1">{year}년 연차 일괄 부여</h3>
              <button type="button" className="cd-btn cd-btn-soft text-[12px]" onClick={() => setBulkModal(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11.5px] cd-text-faint">엑셀에서 &quot;이름·일수&quot; 두 열을 복사해 붙여넣으세요(줄당 1명).</p>
            <textarea className="cd-input min-h-[160px] font-mono text-[12px]" value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={"홍길동\t15\n김철수\t17.5"} />
            {bulkParsed.length > 0 && (
              <div className="rounded-xl border cd-border-c p-2.5 max-h-40 overflow-y-auto text-[11.5px]">
                {bulkParsed.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="cd-text w-24 truncate">{p.name}</span>
                    <span className="cd-text-faint">{isFinite(p.days) ? `${p.days}일` : "-"}</span>
                    {p.error ? <span className="text-[color:var(--cd-danger,#FA896B)] ml-auto">{p.error}</span> : <span className="text-[color:var(--cd-success,#13DEB9)] ml-auto">확인</span>}
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
  catalog,
  addForm,
  setAddForm,
  grantForm,
  setGrantForm,
  busy,
  onToggle,
  onAddUsage,
  onAddGrant,
  onDelete,
  onUpdateDays,
}: {
  row: SummaryRow;
  expanded: boolean;
  entries?: EntryRow[];
  catalog: LeaveTypeItem[];
  addForm: { usedOn: string; typeKey: string; days: string; note: string };
  setAddForm: (f: { usedOn: string; typeKey: string; days: string; note: string }) => void;
  grantForm: { type: "grant" | "adjust"; days: string; note: string };
  setGrantForm: (f: { type: "grant" | "adjust"; days: string; note: string }) => void;
  busy: boolean;
  onToggle: () => void;
  onAddUsage: () => void;
  onAddGrant: () => void;
  onDelete: (entryId: string) => void;
  onUpdateDays: (e: EntryRow, days: number) => void;
}) {
  const usageEntries = (entries ?? []).filter((e) => e.entryType === "use");
  const otherEntries = (entries ?? []).filter((e) => e.entryType !== "use");
  return (
    <>
      <tr className="border-t cd-border-c cursor-pointer hover:bg-[color:var(--cd-surface)]" onClick={onToggle}>
        <td className="py-2 pr-1 cd-text-faint">{expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
        <td className="py-2 pr-3">
          <div className="flex items-center gap-2">
            <EmployeeAvatar employeeId={r.employeeId} photoPath={r.photoPath} size={26} />
            <span className="cd-text font-semibold">
              {r.name}
              {r.positionName && <span className="cd-text-faint font-normal text-[11px]"> {r.positionName}</span>}
            </span>
          </div>
        </td>
        <td className="py-2 pr-3 cd-text-faint">{r.deptName ?? "-"}</td>
        <td className="py-2 pr-3 text-right font-mono">{fmtDays(r.granted)}</td>
        <td className="py-2 pr-3 text-right font-mono">{fmtDays(r.usedAnnual)}</td>
        <td className={`py-2 pr-3 text-right font-mono font-bold ${r.remaining < 0 ? "text-[color:var(--cd-danger,#FA896B)]" : "cd-text"}`}>{fmtDays(r.remaining)}</td>
        <td className="py-2 pr-3 text-right font-mono cd-text-faint">{r.accrual != null ? fmtDays(r.accrual) : "-"}</td>
        <td className="py-2 text-right font-mono cd-text-faint">{r.otherUsed > 0 ? fmtDays(r.otherUsed) : "-"}</td>
      </tr>
      {expanded && (
        <tr className="border-t cd-border-c">
          <td />
          <td colSpan={7} className="py-3">
            <div className="flex flex-col gap-3">
              {/* 날짜별 사용 이력 */}
              <div className="rounded-xl border cd-border-c p-3">
                <div className="text-[11px] font-bold cd-text-faint mb-2">날짜별 휴가 사용 이력</div>
                {!entries ? (
                  <p className="text-[11.5px] cd-text-faint">불러오는 중입니다.</p>
                ) : usageEntries.length === 0 ? (
                  <p className="text-[11.5px] cd-text-faint">사용 이력이 없습니다.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {usageEntries.map((e) => (
                      <div key={e.entryId} className="flex items-center gap-2 text-[11.5px]">
                        <span className="font-mono cd-text w-24 shrink-0">{e.usedOn ?? "-"}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] shrink-0 ${e.deduct ? "cd-tint-primary" : "border cd-border-c cd-text-faint"}`}>
                          {e.leaveLabel ?? e.leaveTypeKey ?? "-"}
                        </span>
                        <input
                          className="cd-input text-right"
                          style={{ width: 56 }}
                          defaultValue={fmtDays(e.days)}
                          onBlur={(ev) => {
                            const v = Number(ev.target.value);
                            if (v > 0 && v !== e.days) onUpdateDays(e, v);
                          }}
                        />
                        <span className="cd-text-faint">일</span>
                        <span className="cd-text-faint truncate flex-1">{e.note ?? ""}</span>
                        <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)] shrink-0" title="삭제" onClick={() => onDelete(e.entryId)}>
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {/* 사용 이력 추가 */}
                <div className="flex items-center gap-1.5 flex-wrap mt-2.5 pt-2.5 border-t cd-border-c">
                  <AutoDateInput className="cd-input" style={{ width: 120 }} value={addForm.usedOn} onChange={(usedOn) => setAddForm({ ...addForm, usedOn })} />
                  <select className="cd-select" style={{ width: 150 }} value={addForm.typeKey} onChange={(e) => setAddForm({ ...addForm, typeKey: e.target.value, days: catalog.find((c) => c.key === e.target.value)?.deduct === "half" ? "0.5" : catalog.find((c) => c.key === e.target.value)?.days != null ? String(catalog.find((c) => c.key === e.target.value)!.days) : addForm.days })}>
                    {catalog.filter((c) => c.active).map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <input className="cd-input text-right" style={{ width: 56 }} inputMode="decimal" value={addForm.days} onChange={(e) => setAddForm({ ...addForm, days: e.target.value })} />
                  <span className="cd-text-faint text-[11px]">일</span>
                  <input className="cd-input" style={{ width: 150 }} placeholder="비고(선택)" value={addForm.note} onChange={(e) => setAddForm({ ...addForm, note: e.target.value })} />
                  <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy} onClick={onAddUsage}>
                    <Plus className="w-3.5 h-3.5 inline" /> 사용 추가
                  </button>
                </div>
              </div>

              {/* 부여/조정 */}
              <div className="rounded-xl border cd-border-c p-3">
                <div className="text-[11px] font-bold cd-text-faint mb-2">부여 · 조정</div>
                {otherEntries.length > 0 && (
                  <div className="flex flex-col gap-1 mb-2">
                    {otherEntries.map((e) => (
                      <div key={e.entryId} className="flex items-center gap-2 text-[11.5px]">
                        <span className="rounded-full px-2 py-0.5 text-[10px] border cd-border-c cd-text-faint shrink-0">{ENTRY_LABEL[e.entryType] ?? e.entryType}</span>
                        <span className="font-mono cd-text">{fmtDays(e.days)}일</span>
                        <span className="cd-text-faint truncate flex-1">{e.note ?? ""}</span>
                        <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)] shrink-0" title="삭제" onClick={() => onDelete(e.entryId)}>
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <select className="cd-select" style={{ width: 90 }} value={grantForm.type} onChange={(e) => setGrantForm({ ...grantForm, type: e.target.value as "grant" | "adjust" })}>
                    <option value="grant">부여</option>
                    <option value="adjust">조정(±)</option>
                  </select>
                  <input className="cd-input text-right" style={{ width: 64 }} inputMode="decimal" placeholder="일수" value={grantForm.days} onChange={(e) => setGrantForm({ ...grantForm, days: e.target.value })} />
                  <input className="cd-input" style={{ width: 170 }} placeholder="메모(선택)" value={grantForm.note} onChange={(e) => setGrantForm({ ...grantForm, note: e.target.value })} />
                  <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy} onClick={onAddGrant}>
                    <Plus className="w-3.5 h-3.5 inline" /> 추가
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
