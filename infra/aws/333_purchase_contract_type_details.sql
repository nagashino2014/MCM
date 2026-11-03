-- 333_purchase_contract_type_details.sql
-- 매입 계약 관리 2차(2026-11-03 사용자 요청) — 계약 유형·분류별로 달라지는 탭 데이터.
--   · 외주 계약 + 단가 계약: 단가 기준표·차수표(매출 contract_rate_cards(200) 와 같은 jsonb 통째 저장)
--   · 정기 구독 + 추가 지출 / 임대(복합기·비데·정수기) + 종량제 / 관리 계약(사무실 관리비): 월별 금액 표
--   · 임대 계약 분류별 상세(부동산·차량·복합기·비데·정수기): purchase_contracts.type_details jsonb
--     (스키마는 frontend/lib/contracts/purchase/type-details.ts 가 단일 원천, 서버가 정규화해 저장)
--   · 차량 렌트는 자산관리 차량(reservable_assets)을 함께 만들어 linked_asset_id 로 연결한다.
-- 외래키 주의(332 교훈): journal_accounts·hometax_tax_invoices 같은 재무 설치 지문 감시 표에는 FK 를 걸지 않는다.
--   reservable_assets·purchase_* 는 감시 표가 아니라 FK 를 둔다.
-- 멱등: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

ALTER TABLE purchase_contracts ADD COLUMN IF NOT EXISTS type_details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE purchase_contracts ADD COLUMN IF NOT EXISTS linked_asset_id text REFERENCES reservable_assets(asset_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_contracts_linked_asset ON purchase_contracts(linked_asset_id);

-- 단가 기준표·차수표(외주 계약 + 단가 계약). card 는 lib/contracts/rate-card.ts RateCardData v2 전체.
CREATE TABLE IF NOT EXISTS purchase_contract_rate_cards (
  purchase_contract_id text PRIMARY KEY REFERENCES purchase_contracts(purchase_contract_id) ON DELETE CASCADE,
  card        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  text NOT NULL,
  updated_by  text REFERENCES users(user_id) ON DELETE SET NULL
);

-- 월별 금액 — 추가 지출(extra_spend)·종량제 요금(metered)·관리비 납부(management_fee) 공용.
--   purpose: 추가 지출 목적(예: LLM 분석량 증가)
--   detail : 관리비 명세서 파싱 결과 {supplyAmount, vat, taxableTotal, nontaxTotal, dueDate, items:[{name, amount, taxType}]}
--   document_id: 관리비 명세서 PDF(purchase_contract_documents, document_type='fee_statement')
CREATE TABLE IF NOT EXISTS purchase_contract_monthly_amounts (
  entry_id text PRIMARY KEY,
  purchase_contract_id text NOT NULL REFERENCES purchase_contracts(purchase_contract_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('extra_spend', 'metered', 'management_fee')),
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount double precision,
  purpose text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_id text REFERENCES purchase_contract_documents(document_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  UNIQUE (purchase_contract_id, kind, year, month)
);

CREATE INDEX IF NOT EXISTS idx_pcma_contract_kind_year
  ON purchase_contract_monthly_amounts(purchase_contract_id, kind, year);
