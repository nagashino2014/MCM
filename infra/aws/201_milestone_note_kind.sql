-- 201: 어음 종류 — 200(어음 수금 상세) 보완
-- 배경: 어음 발행 건을 나중에 찾을 때 어느 어음 상품(전자어음/외담대/상생협력론 등)인지
--       기록이 없으면 담당자가 특정하기 어렵다. 단계에 상품명을 명기해 둔다.

ALTER TABLE contract_payment_milestones
  ADD COLUMN IF NOT EXISTS note_kind text;  -- 어음 종류: 전자어음 / 외담대 / 상생협력론 / 구매론 / 종이어음 등 자유 입력
