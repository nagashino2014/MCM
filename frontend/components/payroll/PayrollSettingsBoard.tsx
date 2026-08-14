"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Save } from "lucide-react";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import type { PayrollItemDef } from "@/lib/payroll/queries";

/**
 * 급여 항목·설정 보드 (PL-P1, 블루프린트 §4-3)
 * - 항목 사전 CRUD: 정규화 명칭·별칭·통상임금 산입 토글·정렬·활성.
 * - in_ordinary_wage 는 초과근무수당 시급 산정(§6)의 기준이므로 변경 시 안내 문구 표시.
 */

type Draft = PayrollItemDef & { aliasText: string; dirty?: boolean };

function toDraft(i: PayrollItemDef): Draft {
  return { ...i, aliasText: i.aliases.join(", ") };
}

export default function PayrollSettingsBoard() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [kindTab, setKindTab] = useState<"pay" | "deduction">("pay");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () =>
    fetch("/api/payroll/items", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setDrafts((d.items ?? []).map(toDraft)))
      .catch(() => setDrafts([]));

  useEffect(() => {
    load();
  }, []);

  const list = useMemo(() => drafts.filter((d) => d.kind === kindTab), [drafts, kindTab]);
  const dirtyCount = drafts.filter((d) => d.dirty).length;

  const patch = (itemId: string, p: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.itemId === itemId ? { ...d, ...p, dirty: true } : d)));

  const addItem = () => {
    const itemId = `custom-${Date.now().toString(36)}`;
    setDrafts((prev) => [
      ...prev,
      {
        itemId,
        name: "",
        kind: kindTab,
        aliases: [],
        aliasText: "",
        inOrdinaryWage: false,
        displayOrder: Math.max(0, ...prev.filter((d) => d.kind === kindTab).map((d) => d.displayOrder)) + 10,
        isActive: true,
        usageCount: 0,
        dirty: true,
      },
    ]);
  };

  const saveAll = async () => {
    const dirty = drafts.filter((d) => d.dirty && d.name.trim());
    if (!dirty.length) return;
    setSaving(true);
    setMsg(null);
    try {
      for (const d of dirty) {
        const res = await fetch("/api/payroll/items", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId: d.itemId,
            name: d.name.trim(),
            kind: d.kind,
            aliases: d.aliasText.split(",").map((s) => s.trim()).filter(Boolean),
            inOrdinaryWage: d.inOrdinaryWage,
            displayOrder: d.displayOrder,
            isActive: d.isActive,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? `${d.name} 저장 실패`);
      }
      setMsg(`${dirty.length}개 항목이 저장되었습니다.`);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <CdPageHeader
        title="급여 항목·설정"
        meta={`지급 ${drafts.filter((d) => d.kind === "pay").length}종 · 공제 ${drafts.filter((d) => d.kind === "deduction").length}종`}
        actions={
          <div className="flex items-center gap-2">
            {msg && <span className="text-xs cd-text-faint">{msg}</span>}
            <button type="button" className="cd-btn rounded-xl px-3 py-2 text-sm font-semibold flex items-center gap-1.5" onClick={addItem}>
              <Plus className="w-4 h-4" /> 항목 추가
            </button>
            <button
              type="button"
              disabled={saving || !dirtyCount}
              onClick={saveAll}
              className="cd-fill-primary text-white rounded-xl px-3.5 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save className="w-4 h-4" /> 저장{dirtyCount ? ` (${dirtyCount})` : ""}
            </button>
          </div>
        }
      />

      <section className="cd-card rounded-3xl flex-1 min-h-0 flex flex-col cd-reveal">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex rounded-xl border cd-border-c overflow-hidden text-sm font-semibold">
            {(["pay", "deduction"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKindTab(k)}
                className={`px-3.5 py-1.5 transition ${kindTab === k ? "cd-fill-primary text-white" : "cd-text"}`}
              >
                {k === "pay" ? "지급 항목" : "공제 항목"}
              </button>
            ))}
          </div>
          <p className="text-[11px] cd-text-faint">
            통상임금 산입 항목은 초과근무수당 시급(월 통상임금 ÷ 209) 산정에 사용됩니다.
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-auto px-4 pb-4">
          {/* 항목 수가 많아 반폭 테이블 2열로 흘린다(좌: 앞 절반, 우: 뒤 절반) */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-8 items-start">
            {[list.slice(0, Math.ceil(list.length / 2)), list.slice(Math.ceil(list.length / 2))]
              .filter((half) => half.length)
              .map((half, hi) => (
                <table key={hi} className="w-full text-sm">
                  <thead>
                    <tr className="cd-text-faint text-[11px] border-b cd-border-c">
                      <th className="text-left font-semibold p-2">항목명</th>
                      <th className="text-left font-semibold p-2">별칭(콤마 구분)</th>
                      <th className="text-center font-semibold p-2 whitespace-nowrap">통상임금</th>
                      <th className="text-right font-semibold p-2">정렬</th>
                      <th className="text-center font-semibold p-2">활성</th>
                      <th className="text-right font-semibold p-2 whitespace-nowrap">사용 건수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {half.map((d) => (
                      <tr key={d.itemId} className="border-b cd-border-c last:border-0">
                        <td className="p-1.5" style={{ minWidth: 110 }}>
                          <input
                            className="cd-input text-sm w-full"
                            value={d.name}
                            placeholder="항목명"
                            onChange={(e) => patch(d.itemId, { name: e.target.value })}
                          />
                        </td>
                        <td className="p-1.5" style={{ minWidth: 110 }}>
                          <input
                            className="cd-input text-sm w-full"
                            value={d.aliasText}
                            placeholder="예: 자격수당"
                            onChange={(e) => patch(d.itemId, { aliasText: e.target.value })}
                          />
                        </td>
                        <td className="p-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={d.inOrdinaryWage}
                            disabled={d.kind === "deduction"}
                            onChange={(e) => patch(d.itemId, { inOrdinaryWage: e.target.checked })}
                          />
                        </td>
                        <td className="p-1.5 text-right">
                          <input
                            type="number"
                            className="cd-input text-sm text-right"
                            style={{ width: 78 }}
                            value={d.displayOrder}
                            onChange={(e) => patch(d.itemId, { displayOrder: Number(e.target.value) })}
                          />
                        </td>
                        <td className="p-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={d.isActive}
                            onChange={(e) => patch(d.itemId, { isActive: e.target.checked })}
                          />
                        </td>
                        <td className="p-2 text-right cd-text-faint tabular-nums">{(d.usageCount ?? 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
          </div>
          {!list.length && <p className="p-6 text-center text-sm cd-text-faint">항목이 없습니다.</p>}
        </div>
      </section>
    </>
  );
}
