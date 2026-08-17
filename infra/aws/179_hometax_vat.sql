-- 179_hometax_vat.sql
-- 회계 확충 P5: 부가세 신고 자체 수행 — 홈택스 수집 전자(세금)계산서 원장 + 부가세 신고서 스냅
-- 블루프린트: docs/accounting-expansion-blueprint.md §5 P5
-- 바로빌 홈택스 매입매출조회 API 실사(2026-08-17, dev.barobill.co.kr + TI.asmx WSDL):
--   신청 RegistTaxInvoiceScrapEx → 매일 새벽 바로빌이 홈택스에서 수집 보관
--   조회 GetMonthlyTaxInvoice{Purchase,Sales}ListEx (TaxType 1=과세+영세/3=면세, 월 단위, 페이지당 최대 100)
-- 멱등: CREATE TABLE IF NOT EXISTS / ON CONFLICT DO NOTHING

-- ─────────────────────────────────────────────
-- 1. 홈택스 수집 전자(세금)계산서 원장 (불변) + 파생 상태(공제 판정)
--    자사 바로빌 발행분(tax_invoices)과는 국세청 승인번호(nts_send_key)로 dedup 한다.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hometax_tax_invoices (
  hti_id            text PRIMARY KEY,           -- 'hti-' + nts_send_key 해시 앞 12자
  direction         text NOT NULL,              -- 'sales' 매출 / 'purchase' 매입
  nts_send_key      text NOT NULL UNIQUE,       -- 국세청 승인번호 (문서 불변 키)
  nts_send_dt       text,                       -- 국세청 전송일시
  issue_dt          text,                       -- 발급일시
  write_date        text NOT NULL,              -- 작성일자 YYYY-MM-DD (부가세 귀속 기준)
  modify_code       text,                       -- 수정세금계산서 사유 (null=당초분)
  tax_type          integer NOT NULL DEFAULT 1, -- 1 과세 / 2 영세 / 3 면세(계산서)
  purpose_type      integer,                    -- 1 영수 / 2 청구
  invoicer_corp_num text,                       -- 공급자
  invoicer_corp_name text,
  invoicer_ceo_name text,
  invoicer_addr     text,
  invoicer_biz_type text,
  invoicer_biz_class text,
  invoicer_email    text,
  invoicee_corp_num text,                       -- 공급받는자
  invoicee_corp_name text,
  amount_total      numeric NOT NULL DEFAULT 0, -- 공급가액 (수정분 음수 가능)
  tax_total         numeric NOT NULL DEFAULT 0,
  total_amount      numeric NOT NULL DEFAULT 0,
  item_name         text,                       -- 대표 품목(첫 품목명만 조회됨)
  remark1           text,
  late_issue_yn     integer,
  raw_json          jsonb,
  -- 파생 상태 (매입 공제 판정 — card_transactions.vat_deductible 패턴)
  vat_deductible    integer,                    -- 매입: 1 공제 / 0 불공제 / null 미판정(공제 취급). 매출: null
  excluded          integer NOT NULL DEFAULT 0, -- 신고 제외 표시
  memo              text,
  created_at        text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at        text
);
CREATE INDEX IF NOT EXISTS idx_hometax_ti_dir_date ON hometax_tax_invoices(direction, write_date);
CREATE INDEX IF NOT EXISTS idx_hometax_ti_invoicer ON hometax_tax_invoices(invoicer_corp_num);

-- ─────────────────────────────────────────────
-- 2. 부가세 신고서 스냅 (기수별 1건, 계산 결과 form_json 보존 — 산출 근거 드릴다운은 원장 재조회)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vat_returns (
  return_id         text PRIMARY KEY,           -- 'vr-' + (year:term:kind) 해시 앞 12자
  period_year       integer NOT NULL,
  period_term       integer NOT NULL,           -- 1 (1기) / 2 (2기)
  period_kind       text NOT NULL,              -- 'pre' 예정 / 'final' 확정
  date_from         text NOT NULL,              -- YYYY-MM-DD
  date_to           text NOT NULL,
  status            text NOT NULL DEFAULT 'draft', -- draft / confirmed (확정·제출은 항상 사람의 명시 액션 — §7 T5)
  form_json         jsonb NOT NULL,             -- 신고서·합계표·명세서 계산 스냅
  memo              text,
  created_by        text,
  confirmed_by      text,
  confirmed_at      text,
  created_at        text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at        text,
  UNIQUE (period_year, period_term, period_kind)
);
