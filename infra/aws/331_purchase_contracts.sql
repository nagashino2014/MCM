-- 331_purchase_contracts.sql
-- 매입 계약 관리 1차(2026-11-02 사용자 요청) — 매출 계약(contracts)과 별도 표.
--   contracts 는 68파일·127곳에서 매출 전제로 조회되고 contract_direction 필터가 3곳뿐이라
--   같은 표에 매입을 넣으면 트리·대시보드·업무보고·성과급 집계에 섞인다. 그래서 purchase_* 표를 새로 둔다.
--   1) 사업장 거래 구분(매출처·매입처) 2) 매입 계약·청구/지급 단계·문서 3) 권한 purchase.view/edit/delete
-- 멱등: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT DO NOTHING.

-- ─────────────────────────────────────────────
-- 1. 사업장 거래 구분 — 'sales'(매출처) / 'purchase'(매입처) 복수.
--    기존 매출 계약의 계약상대(counterparty_facility_id)는 매출처로 백필한다.
-- ─────────────────────────────────────────────
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS trade_roles text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_facilities_trade_roles ON facilities USING gin(trade_roles);

UPDATE facilities f
   SET trade_roles = array_append(f.trade_roles, 'sales')
 WHERE NOT ('sales' = ANY(f.trade_roles))
   AND EXISTS (
     SELECT 1 FROM contracts c
      WHERE c.counterparty_facility_id = f.facility_id AND c.deleted_at IS NULL
   );

-- ─────────────────────────────────────────────
-- 2. 매입 계약
--    contract_type: outsourcing(외주 계약) / subscription(정기 구독) / lease(임대 계약) / management(관리 계약)
--    contract_category: 유형별 고정 분류 라벨(frontend/lib/contracts/purchase/options.ts 가 단일 원천, 서버가 검증)
--    related_contract_id: 관련 매출 계약(외주 계약 중 도면 작성·산업안전 관련·측정·분석은 필수, 디자인은 선택)
--    is_unit_price / has_extra_spend / is_metered: 단가 계약·추가 지출·종량제 플래그(세부 설정은 후속)
--    account_code: 매입 계정과목(journal_accounts) — 재무 연동 1차는 지정만, 자동 분개는 손대지 않는다.
--    contract_amount: 청구·지급 단계 금액 합계(서버가 재계산, 화면은 읽기 전용)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_contracts (
  purchase_contract_id text PRIMARY KEY,
  contract_title text NOT NULL,
  counterparty_facility_id text NOT NULL REFERENCES facilities(facility_id),
  contract_type text NOT NULL CHECK (contract_type IN ('outsourcing', 'subscription', 'lease', 'management')),
  contract_category text NOT NULL,
  related_contract_id text REFERENCES contracts(contract_id) ON DELETE SET NULL,
  contract_amount double precision,
  contract_date text,
  completed_at text,
  is_unit_price integer NOT NULL DEFAULT 0,
  has_extra_spend integer NOT NULL DEFAULT 0,
  is_metered integer NOT NULL DEFAULT 0,
  account_code text REFERENCES journal_accounts(account_code) ON DELETE SET NULL,
  contract_status text NOT NULL DEFAULT 'active',
  memo text,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  deleted_at text,
  deleted_by text REFERENCES users(user_id) ON DELETE SET NULL,
  delete_reason text
);

CREATE INDEX IF NOT EXISTS idx_purchase_contracts_type ON purchase_contracts(contract_type);
CREATE INDEX IF NOT EXISTS idx_purchase_contracts_counterparty ON purchase_contracts(counterparty_facility_id);
CREATE INDEX IF NOT EXISTS idx_purchase_contracts_related ON purchase_contracts(related_contract_id);
CREATE INDEX IF NOT EXISTS idx_purchase_contracts_date ON purchase_contracts(contract_date);
CREATE INDEX IF NOT EXISTS idx_purchase_contracts_deleted ON purchase_contracts(deleted_at);
CREATE INDEX IF NOT EXISTS idx_purchase_contracts_account ON purchase_contracts(account_code);

-- 청구·지급 단계 — contract_payment_milestones(004) 와 동형. 매출의 발행/수금 자리에 수취/지급을 둔다.
--   hometax_hti_id: 연결한 홈택스 매입 세금계산서(hometax_tax_invoices, direction='purchase')
CREATE TABLE IF NOT EXISTS purchase_contract_milestones (
  milestone_id text PRIMARY KEY,
  purchase_contract_id text NOT NULL REFERENCES purchase_contracts(purchase_contract_id) ON DELETE CASCADE,
  stage_key text NOT NULL,
  stage_label text NOT NULL,
  stage_order integer NOT NULL,
  amount double precision,
  amount_ratio double precision,
  payment_terms text,
  invoice_received integer NOT NULL DEFAULT 0,
  invoice_received_at text,
  invoice_amount double precision,
  hometax_hti_id text REFERENCES hometax_tax_invoices(hti_id) ON DELETE SET NULL,
  payment_paid integer NOT NULL DEFAULT 0,
  payment_paid_at text,
  paid_amount double precision,
  memo text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_contract_milestones_contract_stage
  ON purchase_contract_milestones(purchase_contract_id, stage_key);
CREATE INDEX IF NOT EXISTS idx_purchase_contract_milestones_received
  ON purchase_contract_milestones(invoice_received, invoice_received_at);
CREATE INDEX IF NOT EXISTS idx_purchase_contract_milestones_paid
  ON purchase_contract_milestones(payment_paid, payment_paid_at);
CREATE INDEX IF NOT EXISTS idx_purchase_contract_milestones_hometax
  ON purchase_contract_milestones(hometax_hti_id);

-- 문서 — contract_documents(004) 와 동형(차수 없음). document_type: contract / amendment / invoice
--   저장 키는 purchase-contracts/documents/{YYYY}/(계약일) 계약명/(계약일)계약명 매입계약서.pdf
CREATE TABLE IF NOT EXISTS purchase_contract_documents (
  document_id text PRIMARY KEY,
  purchase_contract_id text NOT NULL REFERENCES purchase_contracts(purchase_contract_id) ON DELETE CASCADE,
  milestone_id text REFERENCES purchase_contract_milestones(milestone_id) ON DELETE SET NULL,
  document_type text NOT NULL DEFAULT 'contract',
  display_name text NOT NULL,
  original_filename text,
  content_type text,
  byte_size bigint,
  sha256 text,
  storage_provider text NOT NULL DEFAULT 's3',
  storage_bucket text,
  storage_key text NOT NULL,
  public_path text,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_purchase_contract_documents_contract
  ON purchase_contract_documents(purchase_contract_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_contract_documents_key
  ON purchase_contract_documents(storage_key);
CREATE INDEX IF NOT EXISTS idx_purchase_contract_documents_sha256
  ON purchase_contract_documents(sha256);

-- ─────────────────────────────────────────────
-- 3. 권한 — purchase.view / purchase.edit / purchase.delete (전사 범위만. 매입은 회계·총무 성격이라 contract.* 와 분리)
--    템플릿: 시스템 관리자·대표이사 3종, 인사/회계 담당(tpl-hr) view·edit, 임원(tpl-exec) view,
--    영업관리(tpl-sales) view·edit(계약 등록은 영업관리본부가 대행). 패턴: 325_permit_industries.sql §3.
-- ─────────────────────────────────────────────
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('purchase.view',   'purchase', 'view',   '매입 계약 조회(/contracts/purchase)',              'all', 0, now()::text),
  ('purchase.edit',   'purchase', 'edit',   '매입 계약 등록·수정·단계 수취/지급·문서 업로드',   'all', 0, now()::text),
  ('purchase.delete', 'purchase', 'delete', '매입 계약 삭제',                                    'all', 1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-' || g.short || '-' || substr(md5(g.template_id || ':' || g.permission_key), 1, 16),
       g.template_id, g.permission_key, 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES
          ('sysadm', 'tpl-system-admin', 'purchase.view'),
          ('sysadm', 'tpl-system-admin', 'purchase.edit'),
          ('sysadm', 'tpl-system-admin', 'purchase.delete'),
          ('ceo',    'tpl-ceo',          'purchase.view'),
          ('ceo',    'tpl-ceo',          'purchase.edit'),
          ('ceo',    'tpl-ceo',          'purchase.delete'),
          ('hr',     'tpl-hr',           'purchase.view'),
          ('hr',     'tpl-hr',           'purchase.edit'),
          ('exec',   'tpl-exec',         'purchase.view'),
          ('sales',  'tpl-sales',        'purchase.view'),
          ('sales',  'tpl-sales',        'purchase.edit')
       ) AS g(short, template_id, permission_key)
 WHERE EXISTS (SELECT 1 FROM permission_templates t WHERE t.template_id = g.template_id)
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants x
      WHERE x.template_id = g.template_id AND x.permission_key = g.permission_key
   );
