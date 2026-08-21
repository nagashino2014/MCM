-- 196: 쇼핑몰 전표 스톡 (11번가·G마켓·옥션·네이버페이·쿠팡)
-- 개정 세법으로 전자상거래 결제 건은 품목이 나오는 신용카드 매출전표를 부가세 증빙으로 제출해야 한다.
-- 전표 수집은 쇼핑몰 로그인 세션과 브라우저가 있는 **개인 PC** 에서만 되므로(scraper/lib/receipts),
-- 각자 PC 에 쌓인 대장(ledger.csv)과 PDF 를 여기로 올려 스테이징에서 함께 조회한다.
--
-- 키 규약: receipt_id = 'shr-' + sha256(site|order_no|receipt_type) 12자리 —
--   같은 주문의 같은 종류 전표를 다시 올려도 한 행으로 합쳐진다(재수집·재업로드 멱등).
-- PDF 는 계약문서 스토리지에 shop-receipts/<몰>/<YYYY-MM>/<파일명> 으로 저장한다.
--   쿠팡 묶음 전표처럼 한 파일에 여러 건이 든 경우 여러 행이 같은 storage_key 를 가리킨다.
-- 관례: text 타임스탬프, 멱등(IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS shop_receipts (
  receipt_id   text PRIMARY KEY,
  site         text NOT NULL,                  -- 11st / gmarket / auction / naver / coupang
  order_no     text NOT NULL,
  order_date   text,                           -- YYYY-MM-DD (전표에서 읽은 값)
  title        text,                           -- 품목
  amount       numeric NOT NULL DEFAULT 0,     -- 합계금액(원)
  receipt_type text NOT NULL,                  -- 카드영수증 / 카드영수증(수동) 등
  method       text,                           -- page.pdf / cdp.printToPDF / manual-import
  storage_key  text,                           -- 전표 PDF 스토리지 키
  file_name    text,
  collected_at text,                           -- 개인 PC 에서 수집한 시각
  uploaded_by  text,                           -- 올린 사람(users.id)
  uploaded_at  text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shop_receipts_date ON shop_receipts(order_date);
CREATE INDEX IF NOT EXISTS idx_shop_receipts_site ON shop_receipts(site, order_date);
