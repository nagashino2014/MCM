"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, UserPlus, Users, X } from "lucide-react";
import type { PayrollItemDef } from "@/lib/payroll/queries";
import { CdTabs } from "@/components/cdash/CdTabs";
import { OrgPickerModal } from "@/components/approval/OrgPickerModal";
import type { OrganizationEmployeeRow } from "@/components/admin/users/types";

/**
 * 수당 지급 규칙 패널 (PL-P4, §6-2 A) — 직원×항목 정액 규칙(기간·지급월 제한).
 * 자격증·주거비·숙박·육아·학자금상환공제가 주 대상이며, 등록된 규칙은 새 대장 생성 시 귀속월 기준으로 자동 반영된다.
 * 하위 탭(2026-09-14 사용자 요청):
 *  - 직원별 설정: 직원을 먼저 고르고 항목·금액을 넣는 기존 방식(개인 예외 관리).
 *  - 항목별 설정: 항목을 고르고 조직도에서 대상자 여러 명을 한 번에 지정(자격증수당처럼 다수 인원 공통 수당).
 *    저장은 직원별 규칙 N건으로 풀려 들어가고, 목록은 같은 조건(항목·금액·기간·지급월·비고)끼리 묶어 보여준다.
 * 항목 목록은 항목 사전의 「규칙」 체크(rule_eligible) 항목만 — 공제·자동 산정 항목은 제외(223).
 */

interface RuleRow {
  ruleId: string;
  employeeId: string;
  employeeName?: string;
  itemId: string;
  itemName?: string;
  amount: number;
  validFrom: string | null;
  validTo: string | null;
  payMonths: number[] | null;
  note: string | null;
  isActive: boolean;
}

interface EmployeeOpt {
  employeeId: string;
  employeeName: string;
}

interface RuleGroup {
  key: string;
  itemId: string;
  itemName: string;
  amount: number;
  validFrom: string | null;
  validTo: string | null;
  payMonths: number[] | null;
  note: string | null;
  rules: RuleRow[];
}

/** 규칙 등록 빈도가 높은 추천 항목(§6-2 A) — 셀렉트 상단 고정 */
// 출장숙박수당은 224부터 출장신청 기반 자동 산정(급여 항목·설정 → 출장 여비) — 규칙 항목에서 제외.
const FEATURED_ITEMS = ["cert", "housing", "childcare", "student-loan"];

const fmt = (v: number) => Math.round(v).toLocaleString();
const parsePayMonths = (s: string): number[] =>
  s.split(",").map((t) => Number(t.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);

const emptyDraft = { itemId: "cert", amount: "", validFrom: "", validTo: "", payMonths: "", note: "" };

export default function PayrollRulesPanel() {
  const [tab, setTab] = useState<"employee" | "item">("employee");
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [items, setItems] = useState<PayrollItemDef[]>([]);
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/payroll/rules", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRules(d.rules ?? []))
      .catch(() => setRules([]));
  }, []);

  useEffect(() => {
    load();
    fetch("/api/payroll/items", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setItems((d.items ?? []).filter((i: PayrollItemDef) => i.isActive && i.ruleEligible !== false)))
      .catch(() => setItems([]));
    fetch("/api/payroll/tax-profiles", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) =>
        setEmployees(
          ((d.profiles ?? []) as Array<{ employeeId: string; employeeName: string }>).map((p) => ({
            employeeId: p.employeeId, employeeName: p.employeeName,
          }))
        )
      )
      .catch(() => setEmployees([]));
  }, [load]);

  const sortedItems = useMemo(() => {
    const featured = FEATURED_ITEMS.map((id) => items.find((i) => i.itemId === id)).filter(
      (i): i is PayrollItemDef => !!i
    );
    const rest = items.filter((i) => !FEATURED_ITEMS.includes(i.itemId));
    return [...featured, ...rest];
  }, [items]);

  const itemSelect = (value: string, onChange: (v: string) => void, width = 150) => (
    <label className="text-xs cd-text-faint">
      항목
      <select className="cd-select text-sm block mt-0.5" style={{ width }} value={value} onChange={(e) => onChange(e.target.value)}>
        {sortedItems.map((i) => (
          <option key={i.itemId} value={i.itemId}>
            {i.name}{i.kind === "deduction" ? " (공제)" : ""}
          </option>
        ))}
      </select>
    </label>
  );

  const removeRule = async (r: RuleRow) => {
    if (!window.confirm(`${r.employeeName}의 ${r.itemName} 규칙을 삭제할까요?`)) return;
    await fetch(`/api/payroll/rules?ruleId=${encodeURIComponent(r.ruleId)}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 px-5 pb-4">
      <div className="flex items-center gap-3 flex-wrap">
        <CdTabs
          items={[
            { key: "employee", label: "직원별 설정" },
            { key: "item", label: "항목별 설정" },
          ]}
          active={tab}
          onChange={(k) => { setTab(k as "employee" | "item"); setMsg(null); }}
        />
        <span className="text-[11px] cd-text-faint">
          {tab === "employee"
            ? "직원 한 명의 개별 수당을 등록합니다."
            : "항목을 고르고 조직도에서 대상자를 여러 명 지정하면 직원별 규칙으로 한 번에 저장됩니다."}
        </span>
        {msg && <span className="text-xs" style={{ color: "var(--cd-error)" }}>{msg}</span>}
      </div>

      {tab === "employee" ? (
        <EmployeeRulesTab
          rules={rules}
          employees={employees}
          itemSelect={itemSelect}
          busy={busy}
          setBusy={setBusy}
          setMsg={setMsg}
          reload={load}
          onRemove={removeRule}
        />
      ) : (
        <ItemRulesTab
          rules={rules}
          items={items}
          itemSelect={itemSelect}
          busy={busy}
          setBusy={setBusy}
          setMsg={setMsg}
          reload={load}
        />
      )}
    </div>
  );
}

/* ───────────── 직원별 설정(기존 화면) ───────────── */

function EmployeeRulesTab({
  rules, employees, itemSelect, busy, setBusy, setMsg, reload, onRemove,
}: {
  rules: RuleRow[];
  employees: EmployeeOpt[];
  itemSelect: (value: string, onChange: (v: string) => void, width?: number) => React.ReactNode;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setMsg: (m: string | null) => void;
  reload: () => void;
  onRemove: (r: RuleRow) => void;
}) {
  const [draft, setDraft] = useState({ employeeId: "", ...emptyDraft });

  const addRule = async () => {
    if (!draft.employeeId || !draft.itemId || !draft.amount) {
      setMsg("직원·항목·금액을 입력하세요.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const payMonths = parsePayMonths(draft.payMonths);
      const res = await fetch("/api/payroll/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: draft.employeeId,
          itemId: draft.itemId,
          amount: Number(draft.amount),
          validFrom: draft.validFrom || null,
          validTo: draft.validTo || null,
          payMonths: payMonths.length ? payMonths : null,
          note: draft.note || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "저장 실패");
      setDraft((p) => ({ ...p, amount: "", note: "" }));
      reload();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* 신규 규칙 입력 행 */}
      <div className="flex items-end gap-3 flex-wrap border cd-border-c rounded-2xl px-4 py-3">
        <label className="text-xs cd-text-faint">
          직원
          <select className="cd-select text-sm block mt-0.5" style={{ width: 120 }} value={draft.employeeId} onChange={(e) => setDraft((p) => ({ ...p, employeeId: e.target.value }))}>
            <option value="">선택</option>
            {employees.map((e) => (
              <option key={e.employeeId} value={e.employeeId}>{e.employeeName}</option>
            ))}
          </select>
        </label>
        {itemSelect(draft.itemId, (v) => setDraft((p) => ({ ...p, itemId: v })))}
        <RuleFields draft={draft} setDraft={(p) => setDraft((prev) => ({ ...prev, ...p }))} />
        <button type="button" disabled={busy} className="cd-fill-primary text-white rounded-xl px-3.5 py-2 text-sm font-bold flex items-center gap-1 disabled:opacity-40" onClick={addRule}>
          <Plus className="w-4 h-4" /> 규칙 추가
        </button>
      </div>

      {/* 규칙 목록 */}
      <div className="flex-1 min-h-0 overflow-auto border cd-border-c rounded-2xl">
        <table className="w-full text-sm">
          <thead className="cd-table-head">
            <tr className="cd-text-faint text-[11px] border-b cd-border-c sticky top-0" style={{ background: "var(--cd-surface)" }}>
              <th className="text-left font-semibold p-2">직원</th>
              <th className="text-left font-semibold p-2">항목</th>
              <th className="text-right font-semibold p-2">월 금액</th>
              <th className="text-left font-semibold p-2">적용 기간</th>
              <th className="text-left font-semibold p-2">지급월</th>
              <th className="text-left font-semibold p-2">비고</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.ruleId} className="border-b cd-border-c last:border-0" style={r.isActive ? undefined : { opacity: 0.55 }}>
                <td className="p-2 cd-text font-semibold">{r.employeeName}</td>
                <td className="p-2 cd-text">
                  {r.itemName}
                  {!r.isActive && <span className="cd-pill cd-pill-idle ml-1.5">비활성</span>}
                </td>
                <td className="p-2 text-right cd-text tabular-nums">{fmt(r.amount)}</td>
                <td className="p-2 cd-text-faint">{r.validFrom ?? "…"} ~ {r.validTo ?? "계속"}</td>
                <td className="p-2 cd-text-faint">{r.payMonths?.length ? `${r.payMonths.join(",")}월` : "매월"}</td>
                <td className="p-2 cd-text-faint">{r.note ?? ""}</td>
                <td className="p-2 text-right">
                  <button type="button" className="cd-btn rounded-lg p-1.5" title="삭제" style={{ color: "var(--cd-error)" }} onClick={() => onRemove(r)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rules.length && <p className="p-6 text-center text-sm cd-text-faint">등록된 규칙이 없습니다. 위에서 추가하세요.</p>}
      </div>
    </>
  );
}

/* ───────────── 항목별 설정 ───────────── */

function ItemRulesTab({
  rules, items, itemSelect, busy, setBusy, setMsg, reload,
}: {
  rules: RuleRow[];
  items: PayrollItemDef[];
  itemSelect: (value: string, onChange: (v: string) => void, width?: number) => React.ReactNode;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setMsg: (m: string | null) => void;
  reload: () => void;
}) {
  const [draft, setDraft] = useState({ ...emptyDraft });
  const [targets, setTargets] = useState<OrganizationEmployeeRow[]>([]);
  // 조직도 모달 — 신규 입력(new) 또는 기존 묶음의 대상자 편집(group key)
  const [picker, setPicker] = useState<{ mode: "new" } | { mode: "group"; group: RuleGroup } | null>(null);
  const [pickerSel, setPickerSel] = useState<OrganizationEmployeeRow[]>([]);

  /** 활성 규칙을 같은 조건끼리 묶는다 — 항목 → 금액 순 */
  const groups = useMemo<RuleGroup[]>(() => {
    const map = new Map<string, RuleGroup>();
    for (const r of rules) {
      if (!r.isActive) continue;
      const key = [r.itemId, r.amount, r.validFrom ?? "", r.validTo ?? "", (r.payMonths ?? []).join(","), r.note ?? ""].join("|");
      const g = map.get(key);
      if (g) g.rules.push(r);
      else map.set(key, { key, itemId: r.itemId, itemName: r.itemName ?? r.itemId, amount: r.amount, validFrom: r.validFrom, validTo: r.validTo, payMonths: r.payMonths, note: r.note, rules: [r] });
    }
    const order = new Map(items.map((i, idx) => [i.itemId, idx]));
    return [...map.values()].sort((a, b) => (order.get(a.itemId) ?? 999) - (order.get(b.itemId) ?? 999) || b.amount - a.amount);
  }, [rules, items]);

  const openPicker = (target: { mode: "new" } | { mode: "group"; group: RuleGroup }) => {
    if (target.mode === "new") setPickerSel(targets);
    else setPickerSel(target.group.rules.map((r) => ({ employeeId: r.employeeId, name: r.employeeName ?? r.employeeId } as OrganizationEmployeeRow)));
    setPicker(target);
  };
  const togglePick = (emp: OrganizationEmployeeRow) =>
    setPickerSel((prev) => (prev.some((p) => p.employeeId === emp.employeeId) ? prev.filter((p) => p.employeeId !== emp.employeeId) : [...prev, emp]));

  const savePicker = async () => {
    if (!picker) return;
    if (picker.mode === "new") {
      setTargets(pickerSel);
      setPicker(null);
      return;
    }
    // 기존 묶음 대상자 편집: 추가된 인원은 같은 조건으로 규칙 생성, 빠진 인원은 규칙 삭제
    const g = picker.group;
    const before = new Set(g.rules.map((r) => r.employeeId));
    const after = new Set(pickerSel.map((p) => p.employeeId));
    const added = pickerSel.filter((p) => !before.has(p.employeeId)).map((p) => p.employeeId);
    const removed = g.rules.filter((r) => !after.has(r.employeeId)).map((r) => r.ruleId);
    setBusy(true);
    setMsg(null);
    try {
      if (added.length) {
        const res = await fetch("/api/payroll/rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeIds: added, itemId: g.itemId, amount: g.amount, validFrom: g.validFrom, validTo: g.validTo, payMonths: g.payMonths, note: g.note }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "저장 실패");
      }
      if (removed.length) {
        const res = await fetch(`/api/payroll/rules?ruleIds=${encodeURIComponent(removed.join(","))}`, { method: "DELETE" });
        if (!res.ok) throw new Error((await res.json()).error ?? "삭제 실패");
      }
      setPicker(null);
      reload();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addGroup = async () => {
    if (!draft.itemId || !targets.length || !draft.amount) {
      setMsg("항목·대상자·금액을 입력하세요.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const payMonths = parsePayMonths(draft.payMonths);
      const res = await fetch("/api/payroll/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeIds: targets.map((t) => t.employeeId),
          itemId: draft.itemId,
          amount: Number(draft.amount),
          validFrom: draft.validFrom || null,
          validTo: draft.validTo || null,
          payMonths: payMonths.length ? payMonths : null,
          note: draft.note || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "저장 실패");
      setMsg(`${targets.length}명 저장(신규 ${data.created} · 갱신 ${data.updated})`);
      setDraft((p) => ({ ...p, amount: "", note: "" }));
      setTargets([]);
      reload();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeGroup = async (g: RuleGroup) => {
    if (!window.confirm(`${g.itemName} ${fmt(g.amount)}원 규칙 ${g.rules.length}건(대상자 ${g.rules.length}명)을 삭제할까요?`)) return;
    await fetch(`/api/payroll/rules?ruleIds=${encodeURIComponent(g.rules.map((r) => r.ruleId).join(","))}`, { method: "DELETE" });
    reload();
  };

  return (
    <>
      {/* 신규 묶음 입력 행 — 항목 → 대상자 → 금액·기간·지급월·비고 */}
      <div className="flex items-end gap-3 flex-wrap border cd-border-c rounded-2xl px-4 py-3">
        {itemSelect(draft.itemId, (v) => setDraft((p) => ({ ...p, itemId: v })))}
        <div className="text-xs cd-text-faint flex flex-col gap-0.5" style={{ minWidth: 200, maxWidth: 420 }}>
          <span>직원</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button type="button" className="cd-btn rounded-xl px-2.5 py-1.5 text-xs font-semibold flex items-center gap-1" onClick={() => openPicker({ mode: "new" })}>
              <UserPlus className="w-3.5 h-3.5" /> 대상자 선택{targets.length ? ` (${targets.length})` : ""}
            </button>
            {targets.map((t) => (
              <NameTag key={t.employeeId} name={t.name} onRemove={() => setTargets((prev) => prev.filter((p) => p.employeeId !== t.employeeId))} />
            ))}
          </div>
        </div>
        <RuleFields draft={draft} setDraft={(p) => setDraft((prev) => ({ ...prev, ...p }))} />
        <button type="button" disabled={busy} className="cd-fill-primary text-white rounded-xl px-3.5 py-2 text-sm font-bold flex items-center gap-1 disabled:opacity-40" onClick={addGroup}>
          <Plus className="w-4 h-4" /> 규칙 추가
        </button>
      </div>

      {/* 항목별 묶음 목록 */}
      <div className="flex-1 min-h-0 overflow-auto border cd-border-c rounded-2xl">
        <table className="w-full text-sm">
          <thead className="cd-table-head">
            <tr className="cd-text-faint text-[11px] border-b cd-border-c sticky top-0" style={{ background: "var(--cd-surface)" }}>
              <th className="text-left font-semibold p-2 whitespace-nowrap">항목</th>
              <th className="text-left font-semibold p-2">직원</th>
              <th className="text-right font-semibold p-2 whitespace-nowrap">월 금액</th>
              <th className="text-left font-semibold p-2 whitespace-nowrap">적용 기간</th>
              <th className="text-left font-semibold p-2 whitespace-nowrap">지급월</th>
              <th className="text-left font-semibold p-2">비고</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} className="border-b cd-border-c last:border-0 align-top">
                <td className="p-2 cd-text font-semibold whitespace-nowrap">{g.itemName}</td>
                <td className="p-2">
                  <div className="flex items-center gap-1 flex-wrap">
                    {g.rules.map((r) => (
                      <span key={r.ruleId} className="cd-pill cd-pill-info">{r.employeeName}</span>
                    ))}
                    <button type="button" className="cd-btn rounded-lg px-1.5 py-1 text-[11px] flex items-center gap-1" title="대상자 편집" onClick={() => openPicker({ mode: "group", group: g })}>
                      <Users className="w-3 h-3" /> {g.rules.length}명
                    </button>
                  </div>
                </td>
                <td className="p-2 text-right cd-text tabular-nums whitespace-nowrap">{fmt(g.amount)}</td>
                <td className="p-2 cd-text-faint whitespace-nowrap">{g.validFrom ?? "…"} ~ {g.validTo ?? "계속"}</td>
                <td className="p-2 cd-text-faint whitespace-nowrap">{g.payMonths?.length ? `${g.payMonths.join(",")}월` : "매월"}</td>
                <td className="p-2 cd-text-faint">{g.note ?? ""}</td>
                <td className="p-2 text-right">
                  <button type="button" className="cd-btn rounded-lg p-1.5" title="묶음 삭제" style={{ color: "var(--cd-error)" }} onClick={() => removeGroup(g)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!groups.length && <p className="p-6 text-center text-sm cd-text-faint">등록된 규칙이 없습니다. 항목을 고르고 대상자를 선택해 추가하세요.</p>}
      </div>

      <OrgPickerModal
        open={picker !== null}
        title={picker?.mode === "group" ? `${picker.group.itemName} ${fmt(picker.group.amount)}원 — 대상자 편집` : "대상자 선택"}
        hint="인원을 클릭해 여러 명을 선택할 수 있습니다. 저장하면 선택된 직원별로 규칙이 만들어집니다."
        onClose={() => setPicker(null)}
        onSelect={togglePick}
        checkedEmployeeIds={pickerSel.map((p) => p.employeeId)}
        size="lg"
        footer={
          <>
            <div className="mr-auto flex items-center gap-1 flex-wrap max-w-[60%]">
              {pickerSel.map((p) => (
                <NameTag key={p.employeeId} name={p.name} onRemove={() => setPickerSel((prev) => prev.filter((x) => x.employeeId !== p.employeeId))} />
              ))}
              {!pickerSel.length && <span className="text-xs cd-text-faint">선택된 인원이 없습니다.</span>}
            </div>
            <button type="button" className="cd-btn rounded-xl px-3 py-2 text-sm font-semibold" onClick={() => setPicker(null)}>취소</button>
            <button type="button" disabled={busy} className="cd-fill-primary text-white rounded-xl px-3.5 py-2 text-sm font-bold disabled:opacity-40" onClick={savePicker}>
              저장 ({pickerSel.length}명)
            </button>
          </>
        }
      />
    </>
  );
}

/* ───────────── 공통 조각 ───────────── */

/** 성명 태그(직함 없이 성명만) */
function NameTag({ name, onRemove }: { name: string; onRemove?: () => void }) {
  return (
    <span className="cd-pill cd-pill-info inline-flex items-center gap-1">
      {name}
      {onRemove && (
        <button type="button" className="rounded-full hover:opacity-70" aria-label={`${name} 제외`} onClick={onRemove}>
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}

function RuleFields({
  draft, setDraft,
}: {
  draft: { amount: string; validFrom: string; validTo: string; payMonths: string; note: string };
  setDraft: (p: Partial<{ amount: string; validFrom: string; validTo: string; payMonths: string; note: string }>) => void;
}) {
  return (
    <>
      <label className="text-xs cd-text-faint">
        월 금액(원)
        <input className="cd-input text-sm block mt-0.5 text-right" style={{ width: 120 }} inputMode="numeric"
          value={draft.amount ? Number(draft.amount).toLocaleString() : ""}
          onChange={(e) => setDraft({ amount: e.target.value.replace(/[^\d]/g, "") })} />
      </label>
      <label className="text-xs cd-text-faint">
        시작(YYYY-MM)
        <input className="cd-input text-sm block mt-0.5" style={{ width: 100 }} placeholder="2026-01" value={draft.validFrom} onChange={(e) => setDraft({ validFrom: e.target.value })} />
      </label>
      <label className="text-xs cd-text-faint">
        종료(YYYY-MM)
        <input className="cd-input text-sm block mt-0.5" style={{ width: 100 }} placeholder="비우면 계속" value={draft.validTo} onChange={(e) => setDraft({ validTo: e.target.value })} />
      </label>
      <label className="text-xs cd-text-faint">
        지급월 제한
        <input className="cd-input text-sm block mt-0.5" style={{ width: 90 }} placeholder="예: 1,9" title="특정 월만 지급 시 콤마 구분(비우면 매월)" value={draft.payMonths} onChange={(e) => setDraft({ payMonths: e.target.value })} />
      </label>
      <label className="text-xs cd-text-faint flex-1" style={{ minWidth: 140 }}>
        비고
        <input className="cd-input text-sm block mt-0.5 w-full" placeholder="자격증명·자녀명 등" value={draft.note} onChange={(e) => setDraft({ note: e.target.value })} />
      </label>
    </>
  );
}
