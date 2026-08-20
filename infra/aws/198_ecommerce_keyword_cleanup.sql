-- 198: 전자상거래·결제대행 상호를 자동분류 키워드에서 제거 (사용자 확정 2026-08-20).
-- 배경: 쿠팡·이니시스 같은 매입처는 같은 상호라도 건마다 계정과목이 갈린다(사무용품 / 탕비실 비품 / …).
--       그런데 시드가 '쿠팡' → 사무용품비, '이니시스·토스페이먼츠·나이스페이·다우데이타' → 지급수수료로
--       고정 매칭해 두어 첫 자동분류가 틀린 값으로 굳는다. 이 상호들은 사용자가 건별로 고르게 둔다.
-- 코드 쪽 대응: lib/barobill/classify.ts:isEcommerceMerchant — 개인카드 영수증은 자동 지정 자체를 건너뛰고,
--              법인카드 원장은 "전자상거래 건만" 필터로 모아 직접 지정한다.
-- 멱등: 해당 키워드가 이미 없으면 변경 없음(jsonb 배열에서 값만 걸러낸다).

UPDATE expense_categories
   SET store_keyword_rules = COALESCE((
         SELECT jsonb_agg(kw ORDER BY ord)
           FROM jsonb_array_elements(store_keyword_rules) WITH ORDINALITY AS k(kw, ord)
          WHERE kw #>> '{}' NOT IN ('쿠팡', '이니시스', '토스페이먼츠', '나이스페이', '다우데이타')
       ), '[]'::jsonb)
 WHERE store_keyword_rules @> '["쿠팡"]'::jsonb
    OR store_keyword_rules @> '["이니시스"]'::jsonb
    OR store_keyword_rules @> '["토스페이먼츠"]'::jsonb
    OR store_keyword_rules @> '["나이스페이"]'::jsonb
    OR store_keyword_rules @> '["다우데이타"]'::jsonb;

-- 이미 이 상호들로 학습된 사전 항목도 지운다 — 남겨 두면 학습 단계에서 그대로 되살아난다.
DELETE FROM card_merchant_links
 WHERE store_name_snapshot IS NOT NULL
   AND (
     store_name_snapshot ILIKE '%쿠팡%' OR store_name_snapshot ILIKE '%네이버%' OR
     store_name_snapshot ILIKE '%이니시스%' OR store_name_snapshot ILIKE '%11번가%' OR
     store_name_snapshot ILIKE '%NHN%' OR store_name_snapshot ILIKE '%지마켓%' OR
     store_name_snapshot ILIKE '%G마켓%' OR store_name_snapshot ILIKE '%옥션%' OR
     store_name_snapshot ILIKE '%티몬%' OR store_name_snapshot ILIKE '%위메프%' OR
     store_name_snapshot ILIKE '%인터파크%' OR store_name_snapshot ILIKE '%카카오페이%' OR
     store_name_snapshot ILIKE '%토스페이먼츠%' OR store_name_snapshot ILIKE '%나이스페이%' OR
     store_name_snapshot ILIKE '%페이코%' OR store_name_snapshot ILIKE '%스마트스토어%'
   );
