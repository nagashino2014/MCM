-- 224: 전자결재 연계 정합성·숙박출장수당·영수증 직접 첨부·쇼핑몰 전표 첨부 (2026-09-15 사용자 요청)
--  1) 국내여비기준표(숙박출장수당) — 직급 하한(rank_order) 구간별 일 단가. 승인된 출장보고서의 선행
--     출장신청서(trip_class='숙박 출장')의 출장기간 일수 × 단가를 급여대장(전월 26~금월 25)에 자동 산정.
--     기존 수당 규칙의 출장숙박수당 정액은 자동 산정으로 대체(사용자 확정) — 규칙은 비활성 보존.
--  2) 개인 영수증 스톡에 출처(source)·지불수단·지출 목적 — 웹 기안 화면 '직접 첨부'(계좌이체 확인증·수기
--     전표 스캔본 PDF/이미지) 지원. PDF 원본은 이미지가 없어 image_key 를 NULL 허용으로 완화.
--  3) 쇼핑몰 전표(shop_receipts)를 지출결의서(법인카드) 표 행·첨부로 담을 때의 문서 귀속(doc_id).
-- 관례: 멱등(IF NOT EXISTS / ON CONFLICT DO NOTHING).

-- ── 1) 숙박출장수당 기준표 ──
CREATE TABLE IF NOT EXISTS trip_lodging_allowance_rules (
  rank_from integer PRIMARY KEY,                   -- positions.rank_order 하한(이상) — 0 = 전 직급 기본
  label text NOT NULL,                             -- 표시명(차장 이하 / 부장 이상)
  daily_amount integer NOT NULL DEFAULT 0,         -- 일 단가(원) — 급여 항목 trip-lodging 으로 지급
  is_active integer NOT NULL DEFAULT 1,
  note text,
  updated_at text NOT NULL DEFAULT now()::text
);
INSERT INTO trip_lodging_allowance_rules (rank_from, label, daily_amount, note) VALUES
  (0, '차장 이하', 30000, '국내여비기준표 — 차장 이하 3만원/일'),
  (70, '부장 이상', 40000, '국내여비기준표 — 부장 이상 4만원/일(임원 포함)')
ON CONFLICT (rank_from) DO NOTHING;

-- 출장숙박수당은 자동 산정 항목으로 전환 — 수당 규칙 선택 대상에서 제외, 기존 정액 규칙은 비활성 보존.
UPDATE payroll_item_defs SET rule_eligible = 0 WHERE item_id = 'trip-lodging';
UPDATE payroll_pay_rules SET is_active = 0, updated_at = now()::text
 WHERE item_id = 'trip-lodging' AND is_active = 1;

-- ── 2) 개인 영수증 직접 첨부 ──
ALTER TABLE personal_receipts ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'mobile'; -- mobile | manual
ALTER TABLE personal_receipts ADD COLUMN IF NOT EXISTS pay_method text;                       -- 현금/계좌이체/개인카드/기타
ALTER TABLE personal_receipts ADD COLUMN IF NOT EXISTS purpose text;                          -- 지출 목적(표 행 detail 프리필)
ALTER TABLE personal_receipts ALTER COLUMN image_key DROP NOT NULL;

-- ── 3) 쇼핑몰 전표 문서 귀속 ──
ALTER TABLE shop_receipts ADD COLUMN IF NOT EXISTS doc_id text;
CREATE INDEX IF NOT EXISTS idx_shop_receipts_doc ON shop_receipts(doc_id) WHERE doc_id IS NOT NULL;
