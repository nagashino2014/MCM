-- 175: 실적 정산이 있는 단계의 수금금액을 실제 받은 금액(정산액)으로 맞춘다.
-- 배경: 정산으로 감액된 건도 수금금액에는 정산 전 청구금액이 그대로 남아 있었다.
--   예) 수도권매립지공사 준공금 — 청구 51,320,810 / 정산 48,932,922 / 실제 입금 53,826,214(=정산액×1.1)
--   수금금액이 실제와 달라 수금 자동대조가 실패하고, 계약별 수금 합계도 과대 계상된다.
-- 안전장치:
--   · 부분입금 이력(partial_payments_json)이 있는 건은 제외 — 실제 입금 기록이므로 사람이 넣은 값을 존중한다.
--   · payment_collected(완납 플래그)는 건드리지 않는다. 미수금 목록은 이 플래그 기준이라
--     금액만 낮춰도 완납 건이 미수로 되살아나지 않는다.
--   · collection_ratio 는 정산액 기준으로 다시 계산한다(청구금액 대비 실수금 비율).

UPDATE contract_payment_milestones m
   SET collected_amount = m.settlement_amount,
       collection_ratio = CASE
         WHEN COALESCE(m.invoice_amount, m.amount, 0) > 0
           THEN ROUND((m.settlement_amount / COALESCE(m.invoice_amount, m.amount))::numeric, 3)
         ELSE m.collection_ratio
       END,
       updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE m.settlement_amount IS NOT NULL
   AND m.settlement_amount > 0
   AND m.payment_collected = 1
   AND COALESCE(m.collected_amount, 0) <> m.settlement_amount
   AND (m.partial_payments_json IS NULL OR jsonb_array_length(COALESCE(m.partial_payments_json, '[]'::jsonb)) = 0);

-- 적용 결과 확인용(남아 있는 불일치 건)
SELECT count(*) AS remaining_mismatch
  FROM contract_payment_milestones
 WHERE settlement_amount IS NOT NULL AND settlement_amount > 0 AND payment_collected = 1
   AND COALESCE(collected_amount, 0) <> settlement_amount;
