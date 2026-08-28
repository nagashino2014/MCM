"use client";

// 단가 계약 — 범용 단가 기준표 편집기 v2 (2026-08-25 차수 매트릭스 개편).
//
// 실물 단가표(에이에스이코리아·삼성전기·해성디에스) 분석 결론에 맞춘 2단 구조(사용자 확정):
//  ① 단가 기준표 — 항목·단가(허가/신고 2종까지)만. 수량·금액 없음(실물 "표준 계약 단가표" 시트와 동일).
//  ② 차수표 — 수량 입력과 금액 산출을 전담. 추가 발주는 차수를 늘려 수량만 새로 친다.
//     감소율 등으로 단가×수량과 다른 금액은 금액 셀을 직접 고쳐 보정한다(보정 셀은 주황색).
//  청구·수금 단계 옵션: 차수 1개+선급률 없음 → 구분 소계(에이에스이코리아식), 그 외 → 차수별 선급/준공.
// 데이터 모델·계산은 lib/contracts/rate-card.ts (서버 공용) — 이 파일은 UI만 담당한다.

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import {
  type RateCardData,
  type RateCardRound,
  type RateCardStageOption,
  cellAmount,
  cellAutoAmount,
  createRateCardItem,
  createRateCardPayments,
  createRateCardRound,
  decimalStr,
  paymentSplit,
  rateCardGroupNames,
  rateCardGroupTotal,
  rateCardTotal,
  roundStageOptions,
  roundTotal,
  validPayments,
} from "@/lib/contracts/rate-card";

export type { RateCardData, RateCardItem, RateCardRound } from "@/lib/contracts/rate-card";

const digits = (s: string) => s.replace(/[^0-9]/g, "");
const fmtNum = (s: string | number | undefined) => {
  const d = digits(String(s ?? ""));
  return d ? Number(d).toLocaleString("ko-KR") : "";
};

export function RateCardEditor({
  data,
  onChange,
  onAddStages,
}: {
  data: RateCardData;
  onChange: (data: RateCardData) => void;
  /** 변경계약 모달 등에서 차수 파생 단계(선급금/준공금)를 청구·수금 단계로 바로 추가할 때 제공 */
  onAddStages?: (round: RateCardRound, stages: RateCardStageOption[]) => void;
}) {
  const [activeRoundId, setActiveRoundId] = useState(data.rounds[0]?.id ?? "");
  const activeRound = data.rounds.find((r) => r.id === activeRoundId) ?? data.rounds[0];
  const dual = data.dualPrice;
  const groups = rateCardGroupNames(data);
  // 단일 차수 + 지급 단위 없음 = 구분 소계 청구(에이에스이코리아식). 요약도 그 기준으로.
  const groupMode = data.rounds.length === 1 && validPayments(data.rounds[0]).length === 0;

  const updateItem = (id: string, patch: Partial<(typeof data.items)[number]>) => {
    onChange({ ...data, items: data.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  };
  const removeItem = (id: string) => {
    onChange({
      ...data,
      items: data.items.filter((it) => it.id !== id),
      rounds: data.rounds.map((r) => {
        if (!(id in r.cells)) return r;
        const cells = { ...r.cells };
        delete cells[id];
        return { ...r, cells };
      }),
    });
  };
  const updateRound = (id: string, patch: Partial<RateCardRound>) => {
    onChange({ ...data, rounds: data.rounds.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  };
  const updateCell = (round: RateCardRound, itemId: string, patch: Partial<{ qty: string; qty2: string; amount?: string }>) => {
    const prev = round.cells[itemId] ?? { qty: "", qty2: "" };
    const next = { ...prev, ...patch };
    if (next.amount === undefined) delete next.amount;
    updateRound(round.id, { cells: { ...round.cells, [itemId]: next } });
  };

  const addRound = () => {
    // "N차 변경" 자동 라벨 — 기존 라벨에서 최대 차수를 찾아 +1.
    const maxNth = data.rounds.reduce((acc, r) => {
      const m = r.label.match(/(\d+)\s*차/);
      return m ? Math.max(acc, Number(m[1])) : acc;
    }, 0);
    const prev = data.rounds[data.rounds.length - 1];
    const round = createRateCardRound(
      `${maxNth + 1}차 변경`,
      prev && prev.payments.length ? prev.payments.map((p) => ({ ...p })) : createRateCardPayments()
    );
    onChange({ ...data, rounds: [...data.rounds, round] });
    setActiveRoundId(round.id);
  };
  const removeRound = (id: string) => {
    const rounds = data.rounds.filter((r) => r.id !== id);
    onChange({ ...data, rounds });
    if (activeRoundId === id) setActiveRoundId(rounds[rounds.length - 1]?.id ?? "");
  };

  // 금액 셀 — 자동 계산값을 표시하되, 다른 값을 치면 보정으로 저장한다(자동값과 같아지면 해제).
  const onAmountInput = (round: RateCardRound, itemId: string, raw: string) => {
    const item = data.items.find((it) => it.id === itemId);
    if (!item) return;
    const d = digits(raw);
    const auto = cellAutoAmount(item, round.cells[itemId]);
    if (!d || Number(d) === auto) updateCell(round, itemId, { amount: undefined });
    else updateCell(round, itemId, { amount: d });
  };

  const masterCols = dual
    ? "grid-cols-[130px_minmax(0,1fr)_56px_110px_110px_minmax(0,1fr)_28px]"
    : "grid-cols-[130px_minmax(0,1fr)_56px_110px_minmax(0,1fr)_28px]";
  const roundCols = dual
    ? "grid-cols-[minmax(0,1fr)_150px_60px_60px_120px]"
    : "grid-cols-[minmax(0,1fr)_120px_68px_120px]";

  return (
    <div className="grid gap-3">
      <p className="text-[11px] cd-text-faint leading-relaxed">
        <b>① 단가 기준표</b>에 발주처 단가표의 항목·단가만 옮겨 적고, 수량과 금액 산출은 <b>② 차수표</b>가
        전담합니다(감소율 등은 소수 수량 — 예: 16.7 — 이나 금액 셀 직접 보정으로 반영). 삼성전기처럼 추가 발주를{" "}
        <b>1차 변경, 2차 변경…</b> 으로 덧붙이는 계약은 차수를 늘려 수량만 새로 치면 되고, 차수 소계가 지급 단위
        비율(기본 선급금 30/준공금 70, 중도금 추가 가능)에 따라 나뉘어 청구·수금 단계 목록에 나옵니다. 차수가
        1개뿐이고 지급 단위를 모두 지우면 <b>구분별 소계</b>가 단계 목록이 됩니다(지급 구분 방식 발주처).
      </p>

      {/* ① 단가 기준표 — 항목·단가만 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold cd-text-muted">① 단가 기준표 (항목·단가)</span>
        <label className="inline-flex items-center gap-1.5 text-[11px] cd-text-muted select-none">
          <input type="checkbox" checked={dual} onChange={(e) => onChange({ ...data, dualPrice: e.target.checked })} />
          허가/신고 단가 구분(단가 2종)
        </label>
      </div>

      <div className={`grid ${masterCols} gap-1.5 text-[11px] cd-text-faint px-1`}>
        <span>구분</span>
        <span>항목 (세부내용)</span>
        <span>단위</span>
        {dual ? (
          <>
            <span className="text-right">허가 단가</span>
            <span className="text-right">신고 단가</span>
          </>
        ) : (
          <span className="text-right">단가</span>
        )}
        <span>비고</span>
        <span />
      </div>

      {data.items.map((it) => (
        <div key={it.id} className={`grid ${masterCols} gap-1.5 items-center`}>
          <input
            className="cd-input"
            list="rate-card-groups"
            value={it.groupName}
            placeholder="예: 배출시설 증설"
            onChange={(e) => updateItem(it.id, { groupName: e.target.value })}
          />
          <input
            className="cd-input"
            value={it.name}
            placeholder="예: 단설비"
            onChange={(e) => updateItem(it.id, { name: e.target.value })}
          />
          <input className="cd-input" value={it.unit} placeholder="대" onChange={(e) => updateItem(it.id, { unit: e.target.value })} />
          <input
            className="cd-input text-right tabular-nums"
            inputMode="numeric"
            value={fmtNum(it.unitPrice)}
            onChange={(e) => updateItem(it.id, { unitPrice: digits(e.target.value) })}
          />
          {dual && (
            <input
              className="cd-input text-right tabular-nums"
              inputMode="numeric"
              value={fmtNum(it.unitPrice2)}
              onChange={(e) => updateItem(it.id, { unitPrice2: digits(e.target.value) })}
            />
          )}
          <input
            className="cd-input"
            value={it.note}
            placeholder="예: 20대 초과 시 10% 감소"
            onChange={(e) => updateItem(it.id, { note: e.target.value })}
          />
          <button
            type="button"
            className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50"
            title="이 항목 삭제(모든 차수에서 제거)"
            onClick={() => removeItem(it.id)}
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
        onClick={() =>
          onChange({ ...data, items: [...data.items, createRateCardItem(data.items[data.items.length - 1]?.groupName ?? "")] })
        }
      >
        <Plus className="w-4 h-4" />
        항목 추가
      </button>

      {/* ② 차수표 — 수량·금액 산출 전담 */}
      <div className="flex flex-wrap items-center gap-1.5 border-t cd-border-c pt-3">
        <span className="text-xs font-bold cd-text-muted mr-1">② 차수표 (산정 수량·금액)</span>
        {data.rounds.map((r) => (
          <button
            key={r.id}
            type="button"
            className={
              "rounded-full px-3 py-1 text-[11px] font-bold border " +
              (r.id === activeRound?.id
                ? "cd-fill-primary text-white border-transparent shadow-sm"
                : "cd-border-c cd-text-muted hover:cd-tint-primary")
            }
            onClick={() => setActiveRoundId(r.id)}
          >
            {r.label || "차수"}
          </button>
        ))}
        <button
          type="button"
          className="rounded-full px-2.5 py-1 text-[11px] font-bold border border-dashed cd-border-c cd-text-faint hover:cd-tint-primary inline-flex items-center gap-1"
          onClick={addRound}
        >
          <Plus className="w-3 h-3" />
          차수 추가
        </button>
      </div>

      {data.rounds.length === 0 && (
        <p className="rounded-xl border cd-border-c p-3 text-xs cd-text-muted">
          아직 차수가 없습니다. <b>차수 추가</b>를 눌러 산정 수량을 입력하면 금액이 계산되고, 청구·수금 단계
          목록이 만들어집니다. (일반 단가 계약도 차수 1개를 만들어 수량을 입력합니다.)
        </p>
      )}

      {activeRound && (
        <>
          {/* 선택 차수 상세 — 차수명·기준일 + 지급 단위(선급/중도/준공) 목록 */}
          <div className="rounded-xl border cd-border-c p-2.5 grid gap-2">
            <div className="grid grid-cols-[minmax(0,1fr)_150px_28px] gap-2 items-end">
              <label className="grid gap-1 text-[11px]">
                <span className="cd-text-faint font-bold">차수명</span>
                <input
                  className="cd-input"
                  value={activeRound.label}
                  placeholder="예: 1차 변경"
                  onChange={(e) => updateRound(activeRound.id, { label: e.target.value })}
                />
              </label>
              <label className="grid gap-1 text-[11px]">
                <span className="cd-text-faint font-bold">견적 기준일</span>
                <AutoDateInput
                  className="cd-input tabular-nums"
                  value={activeRound.date}
                  onChange={(date) => updateRound(activeRound.id, { date })}
                />
              </label>
              <button
                type="button"
                className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 mb-0.5"
                title="이 차수 삭제"
                onClick={() => removeRound(activeRound.id)}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] cd-text-faint font-bold mr-0.5">지급 단위</span>
              {activeRound.payments.map((p, idx) => (
                <span key={idx} className="inline-flex items-center gap-1 rounded-lg border cd-border-c px-1.5 py-1">
                  <input
                    className="cd-input !py-0.5 !px-1.5 w-[76px] text-[11px]"
                    value={p.label}
                    placeholder="선급금"
                    onChange={(e) => {
                      const payments = activeRound.payments.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x));
                      updateRound(activeRound.id, { payments });
                    }}
                  />
                  <input
                    className="cd-input !py-0.5 !px-1.5 w-[44px] text-[11px] text-right tabular-nums"
                    inputMode="numeric"
                    value={p.ratePct}
                    placeholder="%"
                    onChange={(e) => {
                      const ratePct = digits(e.target.value).slice(0, 3);
                      const payments = activeRound.payments.map((x, i) => (i === idx ? { ...x, ratePct } : x));
                      updateRound(activeRound.id, { payments });
                    }}
                  />
                  <span className="text-[10px] cd-text-faint">%</span>
                  <button
                    type="button"
                    className="text-rose-600 hover:opacity-70"
                    title="이 지급 단위 삭제"
                    onClick={() => updateRound(activeRound.id, { payments: activeRound.payments.filter((_, i) => i !== idx) })}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-[11px] font-bold border border-dashed cd-border-c cd-text-faint hover:cd-tint-primary inline-flex items-center gap-1"
                title="중도금 등 지급 단위 추가 — 마지막 단위(준공금) 앞에 끼워 넣습니다."
                onClick={() => {
                  const payments = activeRound.payments.slice();
                  const inserted = { label: payments.length ? "중도금" : "선급금", ratePct: "" };
                  // 마지막 단위(준공금=잔액) 앞에 삽입 — 비어 있으면 그냥 추가.
                  payments.splice(Math.max(payments.length - 1, 0), 0, inserted);
                  updateRound(activeRound.id, { payments });
                }}
              >
                <Plus className="w-3 h-3" />
                지급 단위 추가
              </button>
              <span className="text-[10px] cd-text-faint">
                마지막 단위 금액은 잔액으로 맞춰집니다. 모두 지우면 구분별 청구.
              </span>
            </div>
          </div>

          {data.items.length === 0 ? (
            <p className="text-[11px] cd-text-faint px-1">단가 기준표에 항목을 먼저 추가하세요.</p>
          ) : (
            <>
              <div className={`grid ${roundCols} gap-1.5 text-[11px] cd-text-faint px-1`}>
                <span>항목</span>
                <span className="text-right">단가{dual ? " (허가 / 신고)" : ""}</span>
                {dual ? (
                  <>
                    <span className="text-right">허가 수량</span>
                    <span className="text-right">신고 수량</span>
                  </>
                ) : (
                  <span className="text-right">수량</span>
                )}
                <span className="text-right">금액</span>
              </div>

              {data.items.map((it) => {
                const cell = activeRound.cells[it.id];
                const overridden = cell?.amount != null && cell.amount !== "";
                const amount = cellAmount(it, cell);
                return (
                  <div key={it.id} className={`grid ${roundCols} gap-1.5 items-center`}>
                    <div className="text-xs cd-text truncate px-1" title={`${it.groupName} · ${it.name}`}>
                      <span className="cd-text-faint">{it.groupName}</span>
                      {it.groupName && it.name ? " · " : ""}
                      {it.name}
                      {it.unit ? <span className="cd-text-faint"> ({it.unit})</span> : null}
                    </div>
                    <div className="text-xs cd-text-faint text-right tabular-nums px-1">
                      {fmtNum(it.unitPrice) || "-"}
                      {dual ? ` / ${fmtNum(it.unitPrice2) || "-"}` : ""}
                    </div>
                    <input
                      className="cd-input text-right tabular-nums"
                      inputMode="decimal"
                      title="감소율 등은 소수 수량으로 반영할 수 있습니다(예: 16.7)"
                      value={cell?.qty ?? ""}
                      onChange={(e) => updateCell(activeRound, it.id, { qty: decimalStr(e.target.value) })}
                    />
                    {dual && (
                      <input
                        className="cd-input text-right tabular-nums"
                        inputMode="decimal"
                        title="감소율 등은 소수 수량으로 반영할 수 있습니다(예: 16.7)"
                        value={cell?.qty2 ?? ""}
                        onChange={(e) => updateCell(activeRound, it.id, { qty2: decimalStr(e.target.value) })}
                      />
                    )}
                    <input
                      className={
                        "cd-input text-right tabular-nums " + (overridden ? "text-amber-600 font-bold" : "opacity-80")
                      }
                      inputMode="numeric"
                      title={
                        overridden
                          ? `수동 보정됨 (자동 계산: ${fmtNum(cellAutoAmount(it, cell)) || 0}원) — 자동값과 같게 고치면 해제`
                          : "단가×수량 자동 계산 — 감소율 등은 직접 고쳐 보정"
                      }
                      value={amount ? amount.toLocaleString("ko-KR") : ""}
                      onChange={(e) => onAmountInput(activeRound, it.id, e.target.value)}
                    />
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      {/* 요약 — 구분 소계 모드(단일 차수·선급률 없음) / 차수별 소계·선급/준공 분해 */}
      {groupMode && groups.length > 0 && (
        <div className="rounded-2xl border cd-border-c p-3 grid gap-1 text-xs">
          <div className="font-bold cd-text-muted mb-1">구분별 소계 (청구 단계 금액)</div>
          {groups.map((g) => (
            <div key={g} className="flex items-center justify-between">
              <span className="cd-text-muted">{g}</span>
              <span className="tabular-nums cd-text">{rateCardGroupTotal(data, g).toLocaleString("ko-KR")}원</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t cd-border-c pt-1 mt-1 font-bold">
            <span className="cd-text">총계</span>
            <span className="tabular-nums cd-text-primary">{rateCardTotal(data).toLocaleString("ko-KR")}원</span>
          </div>
        </div>
      )}

      {!groupMode && data.rounds.length > 0 && (
        <div className="rounded-2xl border cd-border-c p-3 grid gap-1.5 text-xs">
          <div className="font-bold cd-text-muted mb-0.5">차수별 소계 · 지급 단위 분해</div>
          {data.rounds.map((r) => {
            const total = roundTotal(data, r);
            if (total <= 0) return null;
            const split = paymentSplit(total, r.payments);
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="cd-text-muted font-bold min-w-[92px]">
                  {r.label || "차수"}
                  {r.date ? <span className="cd-text-faint font-normal"> {r.date}</span> : null}
                </span>
                <span className="tabular-nums cd-text">{total.toLocaleString("ko-KR")}원</span>
                {split.length > 0 && (
                  <span className="cd-text-faint tabular-nums">
                    {split.map((s) => `${s.label} ${s.amount.toLocaleString("ko-KR")}`).join(" / ")}
                  </span>
                )}
                {onAddStages && (
                  <button
                    type="button"
                    className="ml-auto cd-btn cd-btn-ghost rounded-lg px-2.5 py-1 text-[11px] font-bold cd-text-primary"
                    onClick={() => onAddStages(r, roundStageOptions(data, r))}
                  >
                    청구·수금 단계로 추가
                  </button>
                )}
              </div>
            );
          })}
          <div className="flex items-center justify-between border-t cd-border-c pt-1 mt-1 font-bold">
            <span className="cd-text">총계</span>
            <span className="tabular-nums cd-text-primary">{rateCardTotal(data).toLocaleString("ko-KR")}원</span>
          </div>
        </div>
      )}
    </div>
  );
}
