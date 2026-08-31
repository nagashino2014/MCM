-- 198: 쇼핑몰 전표 매칭 제외 표시 (197 확장)
-- 개인카드로 결제한 개인 용도 구매가 전표에 섞여 들어온다(같은 쇼핑몰 계정을 쓰므로).
-- 이런 건은 법인카드 원장에 상대가 없어 영원히 '미매칭' 으로 남는다 → 제외 표시로 걷어낸다.
-- card_transactions.excluded 와 같은 관례(integer 0/1). 복원은 0 으로 되돌리면 된다.
-- 관례: 멱등(IF NOT EXISTS).

ALTER TABLE shop_receipts ADD COLUMN IF NOT EXISTS excluded integer NOT NULL DEFAULT 0;
