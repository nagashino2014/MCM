-- 176: 175 보완 — 수기 편집(manual_edit)으로 들어간 부분입금 항목도 실적 정산액으로 맞춘다.
-- 175 는 부분입금 이력이 있는 건을 안전하게 건너뛰었는데, 실제로 남아 있던 1건
-- (수도권매립지공사 2025년도 통합환경허가 사후관리 준공금)의 항목은 실제 입금 기록이 아니라
-- 단계 수정 화면에서 만들어진 `id='manual_edit'` 값(정산 전 청구금액)이었다.
-- → 항목이 전부 manual_edit 인 건만 정산액으로 재작성한다. 자동대조·수기 입력한 실제 입금 이력은 그대로 둔다.

UPDATE contract_payment_milestones m
   SET partial_payments_json = jsonb_build_array(
         (m.partial_payments_json -> 0)
         || jsonb_build_object(
              'amount', m.settlement_amount,
              'ratio', CASE WHEN COALESCE(m.invoice_amount, m.amount, 0) > 0
                            THEN ROUND((m.settlement_amount / COALESCE(m.invoice_amount, m.amount))::numeric, 3)
                            ELSE 1 END,
              'memo', '실적 정산 반영(원 청구액 ' || COALESCE(m.invoice_amount, m.amount, 0)::bigint || ')'
            )
       ),
       collected_amount = m.settlement_amount,
       collection_ratio = CASE WHEN COALESCE(m.invoice_amount, m.amount, 0) > 0
                               THEN ROUND((m.settlement_amount / COALESCE(m.invoice_amount, m.amount))::numeric, 3)
                               ELSE m.collection_ratio END,
       updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE m.settlement_amount IS NOT NULL
   AND m.settlement_amount > 0
   AND m.payment_collected = 1
   AND COALESCE(m.collected_amount, 0) <> m.settlement_amount
   AND jsonb_array_length(COALESCE(m.partial_payments_json, '[]'::jsonb)) = 1
   AND m.partial_payments_json -> 0 ->> 'id' = 'manual_edit';

SELECT count(*) AS remaining_mismatch
  FROM contract_payment_milestones
 WHERE settlement_amount IS NOT NULL AND settlement_amount > 0 AND payment_collected = 1
   AND COALESCE(collected_amount, 0) <> settlement_amount;
