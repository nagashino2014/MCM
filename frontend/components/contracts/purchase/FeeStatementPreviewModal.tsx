"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import { AmountInput } from "@/components/ui/AmountInput";
import type { FeeStatementParsed } from "@/lib/contracts/purchase/fee-statement-llm";
import { emptyFeeStatementDetail, type FeeItemTaxType, type FeeStatementDetail } from "@/lib/contracts/purchase/type-details";
import { ModalShell } from "./primitives";

const TAX_LABELS: Record<FeeItemTaxType, string> = { taxable: "과세", nontax: "비과세", exempt: "면세" };

/**
 * 관리비 명세서 인식 결과 확인(333) — AI 가 읽은 연·월·납기내 금액·항목을 저장 전에 고친다.
 * 인식에 실패했으면(parsed=null) 빈 양식으로 열려 직접 적는다.
 */
export function FeeStatementPreviewModal({
  parsed,
  documentName,
  defaultYear,
  onClose,
  onConfirm,
}: {
  parsed: FeeStatementParsed | null;
  documentName: string;
  defaultYear: number;
  onClose: () => void;
  onConfirm: (value: { year: number; month: number; amount: number; detail: FeeStatementDetail }) => Promise<void>;
}) {
  const [year, setYear] = useState(String(parsed?.year ?? defaultYear));
  const [month, setMonth] = useState(String(parsed?.month ?? new Date().getMonth() + 1));
  const [detail, setDetail] = useState<FeeStatementDetail>(() => (parsed ? { ...parsed } : emptyFeeStatementDetail()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<FeeStatementDetail>) => setDetail((prev) => ({ ...prev, ...patch }));
  const itemsTotal = detail.items.reduce((acc, it) => acc + (it.amount || 0), 0);

  const submit = async () => {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) return setError("연도를 확인해 주세요.");
    if (!Number.isInteger(m) || m < 1 || m > 12) return setError("월을 확인해 주세요.");
    if (detail.amountDue == null) return setError("납기내 금액을 입력해 주세요.");
    setSaving(true);
    setError(null);
    try {
      await onConfirm({ year: y, month: m, amount: detail.amountDue, detail });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="관리비 명세서 확인" onClose={onClose} wide>
      <div className="p-5 grid gap-4">
        <p className="text-xs cd-text-muted">
          <b>{documentName}</b>
          {parsed ? (
            <>
              {" "}— {parsed.buildingName || "명세서"}에서 읽은 값입니다. 틀린 곳을 고친 뒤 저장하면 해당 월 칸에 반영됩니다.
            </>
          ) : (
            <> — 자동 인식에 실패했습니다(AI 키 미설정 또는 양식 불일치). 직접 적어 주세요.</>
          )}
        </p>
        <div className="grid grid-cols-4 gap-3">
          <Field label="부과 연도">
            <input className="cd-input tabular-nums" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} />
          </Field>
          <Field label="부과 월">
            <select className="cd-select" value={month} onChange={(e) => setMonth(e.target.value)}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((mo) => (
                <option key={mo} value={String(mo)}>{mo}월</option>
              ))}
            </select>
          </Field>
          <Field label="납기내 금액(원)">
            <AmountInput className="cd-input tabular-nums text-right font-semibold" value={detail.amountDue ?? ""} onChange={(v) => set({ amountDue: v === "" ? null : Number(v) })} />
          </Field>
          <Field label="납부기한">
            <AutoDateInput className="cd-input tabular-nums" value={detail.dueDate} onChange={(dueDate) => set({ dueDate })} />
          </Field>
          <Field label="공급가액">
            <AmountInput className="cd-input tabular-nums text-right" value={detail.supplyAmount ?? ""} onChange={(v) => set({ supplyAmount: v === "" ? null : Number(v) })} />
          </Field>
          <Field label="부가세">
            <AmountInput className="cd-input tabular-nums text-right" value={detail.vat ?? ""} onChange={(v) => set({ vat: v === "" ? null : Number(v) })} />
          </Field>
          <Field label="과세 합계">
            <AmountInput className="cd-input tabular-nums text-right" value={detail.taxableTotal ?? ""} onChange={(v) => set({ taxableTotal: v === "" ? null : Number(v) })} />
          </Field>
          <Field label="비과세·면세 합계">
            <AmountInput className="cd-input tabular-nums text-right" value={detail.nontaxTotal ?? ""} onChange={(v) => set({ nontaxTotal: v === "" ? null : Number(v) })} />
          </Field>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold cd-text">항목별 청구 금액</span>
            <span className="text-[11px] cd-text-faint">항목 합계 {itemsTotal.toLocaleString("ko-KR")}원</span>
            <button
              type="button"
              className="ml-auto cd-btn cd-btn-ghost cd-btn-sm inline-flex items-center gap-1"
              onClick={() => set({ items: [...detail.items, { name: "", amount: 0, taxType: "taxable" }] })}
            >
              <Plus className="w-3.5 h-3.5" /> 항목 추가
            </button>
          </div>
          <div className="rounded-lg border cd-border-c overflow-hidden max-h-[300px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="cd-surface-bg cd-text-faint text-left">
                  <th className="px-3 py-2 font-medium">항목</th>
                  <th className="px-3 py-2 font-medium text-right w-[150px]">금액</th>
                  <th className="px-3 py-2 font-medium w-[96px]">구분</th>
                  <th className="px-2 py-2 w-9"></th>
                </tr>
              </thead>
              <tbody>
                {detail.items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center cd-text-faint">항목이 없습니다. 총액만 저장할 수도 있습니다.</td>
                  </tr>
                )}
                {detail.items.map((it, i) => (
                  <tr key={i} className="border-t cd-border-c">
                    <td className="px-2 py-1">
                      <input className="cd-input text-xs" value={it.name} onChange={(e) => set({ items: detail.items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                    </td>
                    <td className="px-2 py-1">
                      <AmountInput className="cd-input text-xs tabular-nums text-right" value={it.amount} onChange={(v) => set({ items: detail.items.map((x, j) => (j === i ? { ...x, amount: Number(v || 0) } : x)) })} />
                    </td>
                    <td className="px-2 py-1">
                      <select className="cd-select text-xs" value={it.taxType} onChange={(e) => set({ items: detail.items.map((x, j) => (j === i ? { ...x, taxType: e.target.value as FeeItemTaxType } : x)) })}>
                        {(Object.keys(TAX_LABELS) as FeeItemTaxType[]).map((t) => (
                          <option key={t} value={t}>{TAX_LABELS[t]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button type="button" className="rounded-lg p-1 cd-text-faint hover:cd-error-text" title="삭제" onClick={() => set({ items: detail.items.filter((_, j) => j !== i) })}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {error && <p className="text-xs cd-error-text">{error}</p>}
      </div>
      <div className="p-5 pt-0 border-t cd-border-c flex justify-end gap-2 mt-2">
        <button type="button" onClick={onClose} className="cd-btn cd-btn-ghost rounded-lg px-4 py-2 text-sm font-semibold cd-text-muted">닫기</button>
        <button type="button" onClick={submit} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-semibold text-white cd-fill-primary disabled:opacity-60">
          {saving ? "저장 중..." : "월별 표에 반영"}
        </button>
      </div>
    </ModalShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm content-start">
      <span className="font-semibold cd-text-muted text-xs">{label}</span>
      {children}
    </label>
  );
}
