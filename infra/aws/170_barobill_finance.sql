-- 170_barobill_finance.sql
-- 바로빌 재무 연동 P0: 계좌/카드 원장 + 매칭/학습 + 계정과목 + 세금계산서 발행 기록 + 수집 로그
-- 블루프린트: docs/barobill-finance-blueprint.md (v1, 2026-08-15)
-- 멱등: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / ON CONFLICT DO NOTHING

-- ─────────────────────────────────────────────
-- 1. 계좌 마스터 (바로빌 등록 계좌 캐시 + 앱 메타)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_accounts (
  account_id        text PRIMARY KEY,           -- 'ba-' + 계좌번호 해시 앞 12자
  bank_code         text NOT NULL,              -- 바로빌 은행코드: KB / IBK / SHINHAN / HANA / WOORI / NH ...
  bank_name         text,
  account_no        text NOT NULL UNIQUE,       -- 하이픈 제외 숫자 (바로빌 조회 파라미터로 원문 필요, 화면은 마스킹)
  account_alias     text,
  collect_cycle     text NOT NULL DEFAULT 'DAY1',
  barobill_status   text NOT NULL DEFAULT 'active',  -- active / stopped (바로빌 측 상태 캐시)
  is_active         integer NOT NULL DEFAULT 1,      -- 앱 수집 활성 토글
  last_synced_at    text,                            -- 마지막 원장 pull 완료 시각
  created_at        text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at        text
);

-- ─────────────────────────────────────────────
-- 2. 계좌 거래 원장 (불변)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_transactions (
  txn_id            text PRIMARY KEY,           -- 'btx-' + dedup_key 해시
  account_id        text NOT NULL REFERENCES bank_accounts(account_id) ON DELETE CASCADE,
  txn_at            text NOT NULL,              -- YYYY-MM-DD HH:MI:SS (TransDT 14자리 변환)
  direction         text NOT NULL,              -- 'in' / 'out' / 'etc' (TransDirection 입금/출금/기타)
  amount            numeric NOT NULL,           -- 양수 (in=Deposit, out=Withdraw)
  balance_after     numeric,                    -- Balance
  remitter_name_raw text,                       -- TransRemark1 원문 (실측: 국민·기업 모두 R1=거래상대명)
  remitter_name_norm text,                      -- NFKC(전각→반각) → normalizeCompanyName 정규형
  trans_type        text,                       -- TransType (전자금융/타행이체/지로/공과금/FBS출금 ...)
  trans_office      text,                       -- TransOffice
  remark1           text,
  remark2           text,                       -- 실측: 이체메모
  bank_ref          text NOT NULL,              -- TransRefKey (계좌 당 고유)
  dedup_key         text NOT NULL UNIQUE,       -- account_no + ':' + TransRefKey
  source            text NOT NULL DEFAULT 'barobill',
  raw_json          jsonb,
  recon_status      text NOT NULL DEFAULT 'unprocessed', -- unprocessed/suggested/confirmed/ignored/unmatched/on_hold
  created_at        text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_bank_txn_account_at ON bank_transactions(account_id, txn_at);
CREATE INDEX IF NOT EXISTS idx_bank_txn_recon ON bank_transactions(recon_status);
CREATE INDEX IF NOT EXISTS idx_bank_txn_remitter ON bank_transactions(remitter_name_norm);
CREATE INDEX IF NOT EXISTS idx_bank_txn_dir_amount ON bank_transactions(direction, amount);

-- ─────────────────────────────────────────────
-- 3. 수금 매칭 (판정 헤더 / 배분 라인 / 입금자명 학습) — 엔진은 P3, 그릇만 선반영
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recon_matches (
  match_id          text PRIMARY KEY,
  txn_id            text NOT NULL REFERENCES bank_transactions(txn_id) ON DELETE CASCADE,
  match_type        text NOT NULL,              -- exact_1to1/sum_nto1/partial/overpaid/prepaid/unmatched/non_receivable
  status            text NOT NULL DEFAULT 'suggested', -- suggested/confirmed/rejected/manual
  confidence        numeric,
  matched_facility_id text,
  matched_amount    numeric,
  residual_amount   numeric,
  reason_json       jsonb,
  created_by        text NOT NULL DEFAULT 'system',
  confirmed_by      text,
  confirmed_at      text,
  created_at        text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_recon_matches_txn ON recon_matches(txn_id);
CREATE INDEX IF NOT EXISTS idx_recon_matches_status ON recon_matches(status);

CREATE TABLE IF NOT EXISTS recon_match_lines (
  line_id           text PRIMARY KEY,
  match_id          text NOT NULL REFERENCES recon_matches(match_id) ON DELETE CASCADE,
  milestone_id      text NOT NULL,              -- contract_payment_milestones.milestone_id
  allocated_amount  numeric NOT NULL,
  created_at        text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_recon_lines_match ON recon_match_lines(match_id);
CREATE INDEX IF NOT EXISTS idx_recon_lines_milestone ON recon_match_lines(milestone_id);

CREATE TABLE IF NOT EXISTS bank_remitter_links (
  remitter_name_norm text PRIMARY KEY,
  facility_id       text NOT NULL,
  confidence_seed   numeric DEFAULT 0,
  confirm_count     integer NOT NULL DEFAULT 0,
  last_confirmed_at text,
  created_at        text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')
);

-- ─────────────────────────────────────────────
-- 4. 카드 마스터 (바로빌 등록 카드 캐시 + 앱 메타)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS card_registry (
  card_id           text PRIMARY KEY,           -- 'cd-' + 카드번호 해시 앞 12자
  card_company      text NOT NULL,              -- BC / LOTTE / KB ...
  card_company_name text,
  card_num          text NOT NULL UNIQUE,       -- 하이픈 제외 (조회 파라미터로 원문 필요, 화면은 마스킹)
  card_alias        text,
  holder_employee_id text,                      -- 소지 직원 (결의서 기본 필터)
  card_type         text NOT NULL DEFAULT 'C',
  collect_target    text NOT NULL DEFAULT 'PURCHASE',
  collect_cycle     text NOT NULL DEFAULT 'DAY1',
  barobill_status   text NOT NULL DEFAULT 'active',
  is_active         integer NOT NULL DEFAULT 1,
  last_synced_at    text,
  created_at        text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at        text
);

-- ─────────────────────────────────────────────
-- 5. 카드 매입 원장 (불변) + 파생 상태(분류·문서 귀속)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS card_transactions (
  card_txn_id       text PRIMARY KEY,           -- 'ctx-' + dedup_key 해시
  card_id           text NOT NULL REFERENCES card_registry(card_id) ON DELETE CASCADE,
  history_key       text NOT NULL,              -- HistoryKey (카드 당 고유)
  dedup_key         text NOT NULL UNIQUE,       -- card_num + ':' + HistoryKey
  approval_type     text NOT NULL,              -- 승인/취소/부분취소/거절/환불
  approval_num      text,
  approved_at       text NOT NULL,              -- ApprovalDT 변환 (실측: 사용일시의 기준 — 롯데는 날짜만)
  use_date          text,                       -- UseDate (BC=매입일 / 롯데=null)
  amount_total      numeric NOT NULL,           -- ApprovalAmount (승인 총액)
  supply_amount     numeric,                    -- 실측: BC·롯데 모두 Amount=0 → amount_total - tax_amount 역산 저장
  tax_amount        numeric,                    -- Tax (면세·해외=0)
  service_charge    numeric,
  store_corp_num    text,                       -- 가맹점 사업자번호 (분류 학습 키, 해외결제=null)
  store_name        text,
  store_ceo         text,
  store_addr        text,
  store_biz_type    text,                       -- 업태 원문 (실측: BC는 공백 혼입 "주 차 장" → 매칭 시 공백 제거)
  store_corp_type   integer,
  store_tax_type    integer,                    -- 과세유형 (2간이/4면세/6비영리 등 = 매입세액 불공제 후보)
  is_purchased      integer NOT NULL DEFAULT 0,
  payment_plan      text,
  installment_months text,
  use_location      text,
  is_debit          integer NOT NULL DEFAULT 0,
  raw_json          jsonb,
  -- 파생 상태 (원장 위 재계산 가능 레이어)
  category_key      text,                       -- expense_categories.category_key (null=미분류)
  category_source   text,                       -- learned / rule / keyword / manual
  vat_deductible    integer,                    -- 1 공제 / 0 불공제 / null 미판정
  doc_id            text,                       -- 귀속 결재문서 (null=미사용)
  doc_form_id       text,
  excluded          integer NOT NULL DEFAULT 0, -- 경비 아님/개인사용 등 제외 표시
  memo              text,
  created_at        text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at        text
);
CREATE INDEX IF NOT EXISTS idx_card_txn_card_at ON card_transactions(card_id, approved_at);
CREATE INDEX IF NOT EXISTS idx_card_txn_store ON card_transactions(store_corp_num);
CREATE INDEX IF NOT EXISTS idx_card_txn_doc ON card_transactions(doc_id);
CREATE INDEX IF NOT EXISTS idx_card_txn_category ON card_transactions(category_key);
CREATE INDEX IF NOT EXISTS idx_card_txn_type ON card_transactions(approval_type);

-- ─────────────────────────────────────────────
-- 6. 가맹점 분류 학습 사전 (bank_remitter_links 패턴)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS card_merchant_links (
  store_corp_num    text PRIMARY KEY,
  category_key      text NOT NULL,
  store_name_snapshot text,
  confirm_count     integer NOT NULL DEFAULT 0,
  last_confirmed_at text,
  created_at        text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')
);

-- ─────────────────────────────────────────────
-- 7. 계정과목 사전 (+ 자동 분류 규칙)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_categories (
  category_key      text PRIMARY KEY,           -- 'travel' / 'welfare' / ...
  label             text NOT NULL,              -- 여비교통비 / 복리후생비 / ...
  form_option_map   jsonb,                      -- {"frm-expense-report":"교통비", "frm-biz-trip-report":"교통비"} 양식 select 옵션 문자열 매핑
  biz_type_rules    jsonb,                      -- ["철도","택시","주차","주유소",...] 업태(공백 제거 후) 부분일치 키워드
  store_keyword_rules jsonb,                    -- ["코레일","쏘카",...] 상호 부분일치 키워드 (PG 건 주 경로)
  vat_deductible_default integer,               -- 1/0/null
  sort_order        integer NOT NULL DEFAULT 0,
  is_active         integer NOT NULL DEFAULT 1,
  created_at        text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')
);

-- 시드(실측 업태 기반). 운영 중 관리자/부가세 보드에서 보강.
INSERT INTO expense_categories (category_key, label, form_option_map, biz_type_rules, store_keyword_rules, vat_deductible_default, sort_order) VALUES
  ('travel',      '여비교통비', '{"frm-biz-trip-report":"교통비","frm-expense-report":"여비교통비"}',
    '["철도","택시","주차","고속버스","시외버스","항공","여객","렌터카","렌트카","통행료","하이패스"]',
    '["코레일","한국철도공사","쏘카","그린카","카카오T","티맵","한국도로공사"]', 1, 10),
  ('fuel',        '차량유지비', '{"frm-biz-trip-report":"교통비","frm-expense-report":"차량유지비"}',
    '["주유소","주유","충전소","LPG","세차","정비","카센타","타이어"]',
    '["GS칼텍스","SK에너지","S-OIL","현대오일뱅크"]', 1, 20),
  ('lodging',     '숙박비',     '{"frm-biz-trip-report":"숙박비"}',
    '["호텔","모텔","콘도","숙박","리조트","여관","펜션"]',
    '["야놀자","여기어때","호텔스"]', 1, 30),
  ('meal',        '복리후생비', '{"frm-biz-trip-report":"식비","frm-expense-report":"복리후생비"}',
    '["한식","일식","중식","양식","한정식","분식","스넥","스낵","식당","음식","커피","카페","제과","베이커리","치킨","피자","뷔페","주점","횟집","고기","족발","국밥","김밥"]',
    '["스타벅스","이디야","맥도날드","버거킹"]', 1, 40),
  ('supplies',    '사무용품비', '{"frm-expense-report":"사무용품비"}',
    '["문구","사무용품","사무기기","컴퓨터","전산","소프트웨어"]',
    '["오피스디포","알파문구","다나와","쿠팡"]', 1, 50),
  ('consumables', '소모품비',   '{"frm-expense-report":"소모품비"}',
    '["편의점","슈퍼","슈퍼마켓","마트","할인점","잡화"]',
    '["GS25","CU","세븐일레븐","이마트","홈플러스","다이소"]', 1, 60),
  ('printing',    '도서인쇄비', '{"frm-expense-report":"도서인쇄비"}',
    '["인쇄","출판","서적","도서","복사","제본"]',
    '["교보문고","예스24","알라딘"]', 1, 70),
  ('entertain',   '접대비',     '{"frm-expense-report":"접대비"}',
    '["골프","유흥","단란","노래"]',
    '[]', 0, 80),
  ('comm',        '통신비',     '{"frm-expense-report":"통신비"}',
    '["통신","이동전화","인터넷"]',
    '["SKT","KT","LGU","LG유플러스"]', 1, 90),
  ('fee',         '지급수수료', '{"frm-expense-report":"지급수수료"}',
    '["PG","결제대행","공과금","수수료","비영리단체","협회","기관"]',
    '["이니시스","다우데이타","토스페이먼츠","나이스페이"]', 1, 100),
  ('education',   '교육훈련비', '{"frm-expense-report":"교육훈련비"}',
    '["교육","학원","연수","세미나"]',
    '[]', 1, 110),
  ('etc',         '기타',       '{"frm-biz-trip-report":"기타","frm-expense-report":"기타"}',
    '[]', '[]', NULL, 999)
ON CONFLICT (category_key) DO NOTHING;

-- ─────────────────────────────────────────────
-- 8. 전자세금계산서 발행 기록 — 그릇 선반영 (발행 기능은 P4)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_invoices (
  invoice_id        text PRIMARY KEY,
  mgt_key           text NOT NULL UNIQUE,       -- 바로빌 MgtNum (≤24자)
  contract_id       text,
  milestone_id      text,
  direction         text NOT NULL DEFAULT 'sales',
  write_date        text NOT NULL,              -- 작성일자 YYYY-MM-DD
  amount_total      numeric NOT NULL,           -- 공급가액
  tax_total         numeric NOT NULL,
  total_amount      numeric NOT NULL,
  tax_type          integer NOT NULL DEFAULT 1, -- 1 과세 / 2 영세 / 3 면세
  purpose_type      integer NOT NULL DEFAULT 2, -- 1 영수 / 2 청구
  invoicee_facility_id text,
  invoicee_corp_num text,
  invoicee_corp_name text,
  invoicee_email    text,
  line_items        jsonb,
  barobill_state    integer,                    -- 3014=발급완료 ...
  nts_send_state    integer,                    -- 1전송전~4완료/5실패
  nts_send_key      text,                       -- 국세청 승인번호
  nts_send_dt       text,
  nts_result        text,
  is_opened         integer,
  modify_code       text,
  original_invoice_id text,
  issued_by         text,
  issued_at         text,
  canceled_at       text,
  raw_state_json    jsonb,
  created_at        text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at        text
);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_milestone ON tax_invoices(milestone_id);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_contract ON tax_invoices(contract_id);

-- ─────────────────────────────────────────────
-- 9. RBAC 권한키 4종 (블루프린트 §3.5) + 시스템 관리자 템플릿 grant 보충(111 규칙 — 누락 시 관리자조차 403)
-- ─────────────────────────────────────────────
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('finance.view',     'finance', 'view',    '재무(계좌·카드 원장, 부가세 보드) 조회', 'all', 0, now()::text),
  ('finance.manage',   'finance', 'manage',  '계좌·카드 연결 등록/해지, 수집 실행, 분류 확정', 'all', 1, now()::text),
  ('recon.confirm',    'finance', 'recon',   '수금 자동대조 확정/반려 (milestone 수금 반영)', 'all', 1, now()::text),
  ('taxinvoice.issue', 'finance', 'invoice', '전자세금계산서 발행/취소 (국세청 전송, 과금 발생)', 'all', 1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-sysadm-' || substr(md5(p.permission_key), 1, 16),
       'tpl-system-admin', p.permission_key, 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES ('finance.view'), ('finance.manage'), ('recon.confirm'), ('taxinvoice.issue')) AS p(permission_key)
 WHERE EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-system-admin')
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = 'tpl-system-admin' AND g.permission_key = p.permission_key
   );

-- ─────────────────────────────────────────────
-- 10. 수집 배치 로그
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance_sync_logs (
  sync_id           text PRIMARY KEY,
  kind              text NOT NULL,              -- 'bank' / 'card' / 'taxinvoice_state' / 'registry'
  target_id         text,                       -- account_id / card_id
  range_from        text,
  range_to          text,
  fetched           integer NOT NULL DEFAULT 0,
  inserted          integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'running', -- running / ok / error
  error             text,
  started_at        text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
  finished_at       text
);
CREATE INDEX IF NOT EXISTS idx_finance_sync_logs_kind ON finance_sync_logs(kind, started_at);
