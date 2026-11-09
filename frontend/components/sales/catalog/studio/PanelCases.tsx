"use client";

// 오른쪽 패널 · 대표 실적(사업 분야 쪽) — 자동 선별과 직접 입력 중 하나를 고른다(사용자 요청 2026-11-09).
//   자동 선별: 계약 관리에서 '대표 실적'으로 표시한 계약(없으면 금액이 큰 준공 계약) 최대 4건.
//   직접 입력: 연도·용역명·오른쪽 칸(허가일·수행 기간)을 자유롭게 적는다 — 쪽 편집층(PageEdits.cases)에 저장, 이 쪽에만 적용.

import Link from "next/link";
import { ArrowDown, ArrowUp, ExternalLink, Plus, Trash2 } from "lucide-react";
import { CdHelp } from "@/components/cdash/CdHelp";
import { autoCasesOf } from "@/lib/catalog/studio/compose";
import { pageState } from "@/lib/catalog/studio/doc";
import { CASES_MAX_ROWS, CASE_LIMITS, type CaseRowEdit } from "@/lib/catalog/studio/edits";
import type { PanelProps } from "./types";

/** 이 쪽이 대표 실적을 싣는 사업 분야 쪽인가(자동 선별 행을 구할 수 있으면) */
export function hasCasesEditor({ studio, item }: Pick<PanelProps, "studio" | "item">): boolean {
  return Boolean(studio.data && item.maxLevel >= 2 && autoCasesOf(studio.data, item.key));
}

export function CasesEditor({ studio, item, ops }: Pick<PanelProps, "studio" | "item" | "ops">) {
  const data = studio.data;
  const auto = data ? (autoCasesOf(data, item.key) ?? []) : [];
  const manual = pageState(studio.state?.pages ?? [], item.key).edits.cases;
  const rows: CaseRowEdit[] = manual?.rows ?? [];
  // 오른쪽 칸 — 통합환경허가는 허가일, 다른 분야는 수행 기간
  const metaLabel = item.key === "area-1" ? "허가일" : "수행 기간";
  const metaHint = item.key === "area-1" ? "예: 2023-05-12" : "예: 2021.03–2023.08";

  const save = (next: CaseRowEdit[]) => ops.setCases({ mode: "manual", rows: next });
  const setRow = (i: number, patch: Partial<CaseRowEdit>) => save(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };
  // 직접 입력으로 바꿀 때 지금 자동 행을 처음 값으로 옮겨 둔다(없으면 빈 행 하나)
  const toManual = () => save(auto.length ? auto.map((r) => ({ year: r.year, title: r.title, meta: r.meta })) : [{ year: "", title: "", meta: "" }]);

  return (
    <section className="flex flex-col gap-2 rounded-lg border cd-border-c p-2">
      <div className="flex items-center gap-1">
        <h3 className="text-xs font-semibold cd-text">대표 실적</h3>
        <CdHelp topic="catalog.studio-cases" />
      </div>
      <div className="flex gap-1" role="group" aria-label="대표 실적 채우는 방식">
        <button type="button" className="cd-chip cd-chip-sm" data-active={!manual ? "true" : undefined} aria-pressed={!manual} onClick={() => manual && ops.setCases(null)}>
          자동 선별
        </button>
        <button type="button" className="cd-chip cd-chip-sm" data-active={manual ? "true" : undefined} aria-pressed={Boolean(manual)} onClick={() => !manual && toManual()}>
          직접 입력
        </button>
      </div>

      {!manual ? (
        <div className="text-xs cd-text-muted flex flex-col gap-1">
          <p>계약 관리에서 ‘대표 실적’으로 표시한 계약을 싣습니다(없으면 금액이 큰 준공 계약). 지금 {auto.length}건.</p>
          <Link href="/sales/catalog/projects" className="cd-action cd-btn cd-btn-ghost cd-btn-sm self-start" target="_blank" rel="noreferrer">
            <ExternalLink className="w-3.5 h-3.5" /> 실적 노출 관리 열기
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs cd-text-muted">이 쪽에만 적용됩니다. 데이터가 바뀌어도 자동으로 바뀌지 않습니다.</p>
          <ol className="flex flex-col gap-1.5">
            {rows.map((r, i) => (
              <li key={i} className="rounded-lg border cd-border-c p-1.5 flex flex-col gap-1">
                <div className="flex items-center gap-1">
                  <span className="text-[11px] cd-text-faint tabular-nums w-4">{i + 1}</span>
                  <input
                    className="cd-input"
                    style={{ width: 64 }}
                    aria-label={`${i + 1}번 연도`}
                    placeholder="연도"
                    maxLength={CASE_LIMITS.year}
                    value={r.year}
                    onChange={(e) => setRow(i, { year: e.target.value })}
                  />
                  <input
                    className="cd-input flex-1"
                    aria-label={`${i + 1}번 ${metaLabel}`}
                    placeholder={`${metaLabel}(${metaHint})`}
                    maxLength={CASE_LIMITS.meta}
                    value={r.meta}
                    onChange={(e) => setRow(i, { meta: e.target.value })}
                  />
                </div>
                <input
                  className="cd-input"
                  aria-label={`${i + 1}번 용역명`}
                  placeholder="용역명"
                  maxLength={CASE_LIMITS.title}
                  value={r.title}
                  onChange={(e) => setRow(i, { title: e.target.value })}
                />
                <div className="flex items-center gap-0.5">
                  <button type="button" className="cd-icon-button cd-icon-button-sm" aria-label={`${i + 1}번 위로`} onClick={() => move(i, -1)} disabled={i === 0}>
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" className="cd-icon-button cd-icon-button-sm" aria-label={`${i + 1}번 아래로`} onClick={() => move(i, 1)} disabled={i === rows.length - 1}>
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" className="cd-icon-button cd-icon-button-sm ml-auto" aria-label={`${i + 1}번 삭제`} onClick={() => save(rows.filter((_, j) => j !== i))}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {rows.length === 0 ? <p className="text-xs cd-text-faint">행이 없으면 이 쪽에 대표 실적이 나오지 않습니다.</p> : null}
          <button
            type="button"
            className="cd-btn cd-btn-ghost cd-btn-sm self-start"
            onClick={() => save([...rows, { year: "", title: "", meta: "" }])}
            disabled={rows.length >= CASES_MAX_ROWS}
          >
            <Plus className="w-3.5 h-3.5" /> 행 추가
          </button>
        </div>
      )}
    </section>
  );
}
