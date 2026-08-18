-- 187_contact_dept_types.sql
-- 사업장 담당자의 업무 분류를 복수 지정으로 확장(사용자 확정 2026-08-18):
--   기존 dept_type 은 계약/환경 중 하나만 담아 "계약도 하고 계산서도 받는" 담당자를 표현할 수 없었다.
--   dept_types text[] 로 복수 태그를 두고, 계산서 수신 담당자(billing)를 새 값으로 추가한다.
--     contract = 계약부서 · env = 환경부서 · billing = 계산서(전자세금계산서 수신처)
-- dept_type 은 기존 조회(영업 담당자 카드 등) 호환을 위해 남기고 배열의 첫 값과 동기화한다.
-- 멱등: ADD COLUMN IF NOT EXISTS + 백필은 dept_types 가 비어 있을 때만.

ALTER TABLE facility_contact_people ADD COLUMN IF NOT EXISTS dept_types text[];

UPDATE facility_contact_people
   SET dept_types = ARRAY[dept_type]
 WHERE dept_type IS NOT NULL
   AND (dept_types IS NULL OR cardinality(dept_types) = 0);

-- 053 의 CHECK 는 contract/env 만 허용해 billing 저장을 막는다 → 값 집합 확장.
ALTER TABLE facility_contact_people DROP CONSTRAINT IF EXISTS facility_contact_people_dept_type_check;
ALTER TABLE facility_contact_people ADD  CONSTRAINT facility_contact_people_dept_type_check
  CHECK (dept_type IS NULL OR dept_type IN ('contract','env','billing'));

-- 계산서 수신처 프리필 조회(사업장별 billing 담당자)용.
CREATE INDEX IF NOT EXISTS idx_facility_contact_people_dept_types
  ON facility_contact_people USING GIN (dept_types);

-- 전자세금계산서 추가 수신처 — 바로빌은 공급받는자 이메일을 1개만 받으므로(InvoiceeParty.Email),
-- 추가 수신 담당자는 발행 직후 앱(SES)이 안내 메일을 따로 보낸다. 그 대상을 콤마 구분으로 보관한다.
ALTER TABLE tax_invoices ADD COLUMN IF NOT EXISTS invoicee_cc_emails text;
