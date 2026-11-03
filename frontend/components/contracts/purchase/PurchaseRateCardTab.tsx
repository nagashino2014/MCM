"use client";

import { RateCardEditor } from "@/components/contracts/RateCardEditor";
import type { RateCardData, RateCardRound, RateCardStageOption } from "@/lib/contracts/rate-card";

/**
 * 매입 '단가 계약' 탭(333, 2026-11-03 사용자 요청) — 매출 신규 계약 모달의 단가 계약 탭(RateCardEditor)을 그대로 쓰되
 * 허가/신고 단가 구분은 뺀다(hideDualPrice). 하단 차수표·요약·"청구·수금 단계로 추가"는 매출과 같다.
 */
export function PurchaseRateCardTab({
  data,
  onChange,
  onAddStages,
}: {
  data: RateCardData;
  onChange: (data: RateCardData) => void;
  onAddStages?: (round: RateCardRound, stages: RateCardStageOption[]) => void;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-xs cd-text-muted">외주 단가 기준표와 차수별 산정 수량을 적습니다. 차수 소계는 청구·수금 단계 금액으로 가져올 수 있습니다.</p>
      <RateCardEditor data={data} onChange={onChange} onAddStages={onAddStages} hideDualPrice />
    </div>
  );
}
