"use client";

// 업무 항목 트리 편집기(별첨1 행 × 기술등급 MD) — 견적 기준 관리의 기준 세트 편집과
// 견적서 작성의 복수 업무 '항목 입력(수동)'이 같은 편집기를 쓴다(2026-10-01 공용화).
// 제어 컴포넌트: 등급 축·행 모두 부모 state. 세부항목은 위쪽의 가장 가까운 대항목에 소속된다.

import { useState } from "react";
import { X } from "lucide-react";
import { LABOR_GRADES, sortGrades, type QuoteTreeRow } from "@/lib/quote/types";

/**
 * 기술등급 제외 — 그 등급의 MD를 남은 등급에 현재 비율대로 재분배해 행별 MD 합계를 보존한다
 * (남은 값이 모두 0이면 균등 분배).
 */
function redistributeRow(r: QuoteTreeRow, grade: string, next: string[]): QuoteTreeRow {
  const moving = r.baseMd[grade] ?? 0;
  const md: Record<string, number> = {};
  for (const g of next) if (r.baseMd[g]) md[g] = r.baseMd[g];
  if (moving > 0) {
    // 분배 눈금: 기존 값이 모두 정수인 세트는 정수, 0.5 가 섞인 소액 세트는 0.5 단위
    // (사용자 확정 2026-08-07 — 가중치에 소수점이 길게 남지 않게 한다)
    const values = [...Object.values(md), moving];
    const unit = values.every((v) => Number.isInteger(v)) ? 1 : 0.5;
    const target = Object.values(md).reduce((a: number, b: number) => a + b, 0) + moving;
    const base = next.reduce((acc: number, g: string) => acc + (md[g] ?? 0), 0);
    if (base > 0) {
      for (const g of next) if (md[g]) md[g] = Math.round((md[g] + (moving * md[g]) / base) / unit) * unit;
    } else {
      const each = Math.round(moving / next.length / unit) * unit;
      for (const g of next) md[g] = each;
    }
    // 스냅 잔차는 가장 큰 셀이 흡수해 행 합계를 보존한다
    const snapped = next.reduce((acc: number, g: string) => acc + (md[g] ?? 0), 0);
    const diff = Math.round((target - snapped) / unit) * unit;
    if (diff !== 0) {
      const top = next.filter((g) => md[g] != null).sort((a, b) => (md[b] ?? 0) - (md[a] ?? 0))[0];
      if (top) md[top] = Math.max(unit, Math.round((md[top] + diff) / unit) * unit);
    }
  }
  return { ...r, baseMd: md };
}

/** MD 셀 — 입력 중에는 원문을 유지해 '19.' 처럼 소수점을 찍는 도중의 값이 지워지지 않게 한다 */
function MdCell({ value, label, onChange }: { value: number | undefined; label: string; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="w-full bg-transparent text-center outline-none"
      inputMode="decimal"
      value={draft ?? String(value ?? "")}
      placeholder="0"
      aria-label={label}
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d.]/g, "");
        setDraft(v);
        onChange(Number(v) || 0);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

export function QuoteItemTreeEditor({
  grades,
  rows,
  onGradesChange,
  onRowsChange,
}: {
  grades: string[];
  rows: QuoteTreeRow[];
  onGradesChange: (next: string[]) => void;
  onRowsChange: (next: QuoteTreeRow[]) => void;
}) {
  const toggleGrade = (grade: string) => {
    const on = grades.includes(grade);
    const next = on ? grades.filter((g) => g !== grade) : sortGrades([...grades, grade]);
    if (!next.length) {
      alert("기술등급은 최소 1개 이상이어야 합니다.");
      return;
    }
    onGradesChange(next);
    if (on) onRowsChange(rows.map((r) => redistributeRow(r, grade, next))); // 추가는 값 이동 없음
  };
  const patchRow = (i: number, patch: Partial<QuoteTreeRow>) => onRowsChange(rows.map((x, xi) => (xi === i ? { ...x, ...patch } : x)));

  return (
    <>
      {/* 기술등급 축(가변) — 등급을 빼면 그 MD를 남은 등급에 비율대로 재분배한다 */}
      <div className="flex items-center gap-2 flex-wrap text-[11.5px]">
        <span className="cd-text-faint">기술등급</span>
        {(LABOR_GRADES as readonly string[]).map((g) => {
          const on = grades.includes(g);
          return (
            <button
              key={g}
              type="button"
              data-active={on}
              aria-pressed={on}
              className={`cd-choice rounded-lg px-2.5 py-1 border ${on ? "cd-tint-primary border-[color:var(--cd-primary)] cd-text" : "cd-border-c cd-text-faint"}`}
              onClick={() => toggleGrade(g)}
            >
              {g}
            </button>
          );
        })}
        <span className="text-[10.5px] cd-text-faint">
          등급 제외 시 해당 MD는 남은 등급에 비율대로 재분배됩니다(합계 보존).
        </span>
      </div>
      <div className="overflow-x-auto">
        {/* 등급 열은 개수와 무관하게 총폭 고정(40%)을 균등 분할 — 3열이든 5열이든 표 폭이 같다 */}
        <table className="w-full text-[11.5px] border-collapse min-w-[640px] table-fixed">
          <colgroup>
            <col style={{ width: "56px" }} />
            <col />
            {grades.map((g) => (
              <col key={g} style={{ width: `${40 / grades.length}%` }} />
            ))}
            <col style={{ width: "36px" }} />
          </colgroup>
          <thead className="cd-table-head">
            <tr>
              <th className="border cd-border-c px-2 py-1.5 text-left cd-text-faint font-semibold">대항목</th>
              <th className="border cd-border-c px-2 py-1.5 text-left cd-text-faint font-semibold">항목명</th>
              {grades.map((g) => (
                <th key={g} className="border cd-border-c px-2 py-1.5 cd-text-faint font-semibold">{g}</th>
              ))}
              <th className="border cd-border-c" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.isParent ? "cd-tint-primary/40" : ""}>
                <td className="border cd-border-c px-2 py-0.5 text-center">
                  <input type="checkbox" checked={r.isParent} aria-label="대항목" onChange={(e) => patchRow(i, { isParent: e.target.checked })} />
                </td>
                <td className="border cd-border-c px-1 py-0.5">
                  <input
                    className={`w-full bg-transparent outline-none px-1 ${r.isParent ? "font-semibold" : "pl-4"}`}
                    value={r.label}
                    aria-label="항목명"
                    onChange={(e) => patchRow(i, { label: e.target.value })}
                  />
                </td>
                {grades.map((g) => (
                  <td key={g} className="border cd-border-c px-1 py-0.5 text-center">
                    {r.isParent ? (
                      <span className="cd-text-faint text-[10px]">소계</span>
                    ) : (
                      <MdCell
                        value={r.baseMd[g]}
                        label={`${g} MD`}
                        onChange={(n) => {
                          const md = { ...r.baseMd };
                          if (!n) delete md[g];
                          else md[g] = n;
                          patchRow(i, { baseMd: md });
                        }}
                      />
                    )}
                  </td>
                ))}
                <td className="border cd-border-c text-center">
                  <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" aria-label="행 삭제" onClick={() => onRowsChange(rows.filter((_, xi) => xi !== i))}>
                    <X className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-1.5 text-[11.5px] cd-text-faint" onClick={() => onRowsChange([...rows, { label: "", isParent: false, baseMd: {} }])}>
          ＋ 행 추가
        </button>
        <span className="text-[10.5px] cd-text-faint">세부항목은 위쪽의 가장 가까운 대항목에 소속됩니다. 대항목 MD는 자동 소계.</span>
      </div>
    </>
  );
}
