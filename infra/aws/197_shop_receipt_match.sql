-- 197: 쇼핑몰 전표 ↔ 법인카드 원장 매칭 (196_shop_receipts 확장)
-- 개정 세법 대응은 "원장의 결제 건마다 품목이 나오는 전표가 붙어 있는가" 로 완성된다.
-- 전표에 찍힌 승인번호·카드끝4·금액·날짜로 card_transactions 와 잇고, 결과를 전표 행에 남긴다.
--   match_status: auto(자동 확정) / manual(수동 연결) / null(미매칭)
--   match_basis : approval(승인번호+금액) / card(카드끝4+금액+날짜) / order-sum(주문 합산) / amount(금액+날짜) / manual
-- 관례: text 타임스탬프, 멱등(IF NOT EXISTS).

ALTER TABLE shop_receipts ADD COLUMN IF NOT EXISTS approval_num  text;
ALTER TABLE shop_receipts ADD COLUMN IF NOT EXISTS card_last4    text;
ALTER TABLE shop_receipts ADD COLUMN IF NOT EXISTS matched_txn_id text;   -- card_transactions.card_txn_id
ALTER TABLE shop_receipts ADD COLUMN IF NOT EXISTS match_status  text;
ALTER TABLE shop_receipts ADD COLUMN IF NOT EXISTS match_basis   text;
ALTER TABLE shop_receipts ADD COLUMN IF NOT EXISTS matched_at    text;

CREATE INDEX IF NOT EXISTS idx_shop_receipts_matched ON shop_receipts(matched_txn_id);
