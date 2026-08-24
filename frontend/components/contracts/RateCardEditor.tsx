"use client";

// 단가 계약 — 범용 단가 기준표 편집기.
//
// 발주처별 단가표(에이에스이코리아·삼성전기·해성디에스 실물 분석, 2026-08-24)는 양식이
// 제각각이지만, 결국 "지급 구분(그룹) > 항목 > 단위 > 단가 > 수량"의 행 목록으로 평탄화된다.
//  - 구간형(시설 수 5개 이하/10개 이하 …)·차수형(1차/2차)은 구간·차수를 항목명에 붙여 행으로 편다.
//  - 감소율·MD 산정 같은 발주처 고유 규칙은 비고에 적는다(자동 계산은 하지 않는다 — 단순함 우선).
// "구분"이 청구·수금 단계의 목록박스 옵션이 되고, 구분 소계가 해당 단계 금액으로 자동 적용된다.

import { Plus, Trash2 } from "lucide-react";

export interface RateCardItem {
  id: string;
  /** 대금 지급 단위 구분 — 예: 통합환경, 대기총량, 사후관리, 변경허가, 변경신고 */
  groupName: string;
  /** 항목(세부내용) — 예: 변경허가(모델링 포함), 배출시설 증설 단설비, 변경신고(시설 5개 이하) */
  name: string;
  /** 단위 — 건 / 대 / 회 / 식 / 개 / 장 등 */
  unit: string;
  /** 단가(원) — 숫자만 담은 문자열 */
  unitPrice: string;
  /** 수량(가상 횟수·산정 수량) — 숫자만 담은 문자열 */
  qty: string;
  /** 비고 — 과업범위·티어 조건·감소율 등 발주처 고유 규칙 */
  note: string;
}

export function createRateCardItem(groupName = ""): RateCardItem {
  return {
    id: "rci_" + Math.random().toString(36).slice(2, 10),
    groupName,
    name: "",
    unit: "건",
    unitPrice: "",
    qty: "1",
    note: "",
  };
}

const digits = (s: string) => s.replace(/[^0-9]/g, "");
const fmtNum = (s: string) => {
  const d = digits(s);
  return d ? Number(d).toLocaleString("ko-KR") : "";
};

export function rateItemAmount(item: RateCardItem): number {
  const price = Number(digits(item.unitPrice) || 0);
  const qty = Number(digits(item.qty) || 0);
  return price * qty;
}

/** 고유 지급 구분명 — 입력 순서 보존. 청구·수금 단계 목록박스의 옵션이 된다. */
export function rateCardGroupNames(items: RateCardItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    const g = it.groupName.trim();
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

/** 지급 구분 소계 = Σ(단가 × 수량) — 단계명 선택 시 자동 적용되는 금액. */
export function rateCardGroupTotal(items: RateCardItem[], groupName: string): number {
  return items
    .filter((it) => it.groupName.trim() === groupName.trim())
    .reduce((acc, it) => acc + rateItemAmount(it), 0);
}

export function rateCardTotal(items: RateCardItem[]): number {
  return items.reduce((acc, it) => acc + rateItemAmount(it), 0);
}

export function RateCardEditor({
  items,
  onChange,
}: {
  items: RateCardItem[];
  onChange: (items: RateCardItem[]) => void;
}) {
  const update = (id: string, patch: Partial<RateCardItem>) => {
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };
  const groups = rateCardGroupNames(items);

  return (
    <div className="grid gap-3">
      <p className="text-[11px] cd-text-faint leading-relaxed">
        발주처 단가표를 <b>지급 구분 &gt; 항목 &gt; 단위 &gt; 단가 &gt; 수량</b> 행으로 옮겨 적습니다. 시설 수
        구간·차수는 항목명에 붙여 행을 나누고(예: 변경신고 · 시설 5개 이하), 감소율·MD 산정 같은 발주처 고유
        규칙은 비고에 적습니다. <b>지급 구분</b>명이 청구·수금 단계의 단계명 목록으로 나오고, 구분 소계가 단계
        금액으로 자동 적용됩니다.
      </p>

      <div className="grid grid-cols-[130px_minmax(0,1fr)_64px_110px_58px_110px_minmax(0,1fr)_28px] gap-1.5 text-[11px] cd-text-faint px-1">
        <span>지급 구분</span>
        <span>항목 (세부내용)</span>
        <span>단위</span>
        <span className="text-right">단가</span>
        <span className="text-right">수량</span>
        <span className="text-right">금액</span>
        <span>비고 (과업범위·조건)</span>
        <span />
      </div>

      {items.map((it) => (
        <div key={it.id} className="grid grid-cols-[130px_minmax(0,1fr)_64px_110px_58px_110px_minmax(0,1fr)_28px] gap-1.5 items-center">
          <input
            className="cd-input"
            list="rate-card-groups"
            value={it.groupName}
            placeholder="예: 변경허가"
            onChange={(e) => update(it.id, { groupName: e.target.value })}
          />
          <input
            className="cd-input"
            value={it.name}
            placeholder="예: 배출시설 증설 (단설비)"
            onChange={(e) => update(it.id, { name: e.target.value })}
          />
          <input
            className="cd-input"
            value={it.unit}
            placeholder="건"
            onChange={(e) => update(it.id, { unit: e.target.value })}
          />
          <input
            className="cd-input text-right tabular-nums"
            inputMode="numeric"
            value={fmtNum(it.unitPrice)}
            onChange={(e) => update(it.id, { unitPrice: digits(e.target.value) })}
          />
          <input
            className="cd-input text-right tabular-nums"
            inputMode="numeric"
            value={it.qty}
            onChange={(e) => update(it.id, { qty: digits(e.target.value) })}
          />
          <div className="cd-input text-right tabular-nums opacity-70 pointer-events-none select-none">
            {rateItemAmount(it) ? rateItemAmount(it).toLocaleString("ko-KR") : ""}
          </div>
          <input
            className="cd-input"
            value={it.note}
            placeholder="예: 20대 초과 시 10% 감소"
            onChange={(e) => update(it.id, { note: e.target.value })}
          />
          <button
            type="button"
            className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50"
            title="이 행 삭제"
            onClick={() => onChange(items.filter((x) => x.id !== it.id))}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      {/* 이미 입력한 구분명을 datalist 로 제안 — 같은 구분은 철자까지 같아야 하나로 묶인다. */}
      <datalist id="rate-card-groups">
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>

      <button
        type="button"
        className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-sm cd-text-muted inline-flex items-center gap-2 justify-center"
        onClick={() => onChange([...items, createRateCardItem(items[items.length - 1]?.groupName ?? "")])}
      >
        <Plus className="w-4 h-4" />
        항목 추가
      </button>

      {groups.length > 0 && (
        <div className="rounded-2xl border cd-border-c p-3 grid gap-1 text-xs">
          <div className="font-bold cd-text-muted mb-1">지급 구분별 소계</div>
          {groups.map((g) => (
            <div key={g} className="flex items-center justify-between">
              <span className="cd-text-muted">{g}</span>
              <span className="tabular-nums cd-text">{rateCardGroupTotal(items, g).toLocaleString("ko-KR")}원</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t cd-border-c pt-1 mt-1 font-bold">
            <span className="cd-text">총계</span>
            <span className="tabular-nums cd-text-primary">{rateCardTotal(items).toLocaleString("ko-KR")}원</span>
          </div>
        </div>
      )}
    </div>
  );
}
