-- 147: 계약서 작성 시스템 — 용역 분류별 표준 셋 템플릿 + 계약서 대장.
-- 설계: docs/contract-agreement-blueprint.md (2026-08-10 확정: 메뉴는 계약(/contracts/agreements),
--       문서 원본 = approval_docs.field_values(frm-agreement), 승인 후 수동 발송(기본 HWPX 첨부),
--       고유 대외번호 없음, contracts 레코드 자동 생성 없음 — 참조 연결만).
-- 관례: text 타임스탬프, 멱등(IF NOT EXISTS / ON CONFLICT).

-- 1) 계약서 양식 템플릿 — 견적 기준 세트(136 quote_rate_sets)와 동일 패턴으로
--    용역 대분류-세분류당 1개 활성 표준 셋을 관리한다. 기안 시점 조문 전체가
--    approval_docs.field_values 에 스냅되므로 템플릿 수정이 기존 문서를 훼손하지 않는다.
--    발주처 자체양식(kind='custom')은 분류 축이 아니라 발주처(origin_facility_id) 축이며
--    service_type/subtype 은 NULL 허용(UNIQUE 는 NULL 행에 적용되지 않음).
CREATE TABLE IF NOT EXISTS agreement_templates (
  template_id     text PRIMARY KEY,               -- 'agt-' + nanoid (표준 시드는 'agt-std-' + slug)
  name            text NOT NULL,                  -- '통합환경 도급계약서(표준)', '엘에스엠앤엠 자체양식' 등
  kind            text NOT NULL DEFAULT 'standard',  -- standard(분류 축) | custom(발주처 축, 업로드 분석)
  service_type    text,                           -- 계약관리 대분류 (standard 필수)
  service_subtype text,                           -- 계약관리 세분류 (standard 필수)
  version         integer NOT NULL DEFAULT 1,
  status          text NOT NULL DEFAULT 'active', -- active | draft | archived
  origin_facility_id text REFERENCES facilities(facility_id) ON DELETE SET NULL,  -- custom 출처 발주처
  spec            jsonb NOT NULL DEFAULT '{}'::jsonb,  -- AgreementSpec (lib/agreement/types.ts)
  source_kind     text,                           -- hwpx | docx | pdf (custom 업로드 원본 형식)
  source_key      text,                           -- S3 원본 보관 키(재분석용)
  analyzed_at     text,
  analyze_model   text,
  analyze_note    text,                           -- 분석 시 LLM 이 남긴 주의사항·미확신 항목
  created_by      text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at      text NOT NULL,
  updated_at      text NOT NULL,
  UNIQUE (service_type, service_subtype, version)
);

CREATE INDEX IF NOT EXISTS idx_agreement_templates_class
  ON agreement_templates(service_type, service_subtype, status);
CREATE INDEX IF NOT EXISTS idx_agreement_templates_origin
  ON agreement_templates(origin_facility_id);

-- 2) 계약서 대장 — 발송·산출물 메타 (견적 quotations 패턴의 official_letters 미러형).
--    문서 원본은 approval_docs.field_values, 승인 시점 값이 field_snapshot 으로 박제된다.
--    send_status: 기안~결재 중 draft → 최종 승인 시 approved(자동 발송 없음, ①) →
--    수동 발송 실행 시 sending → sent | failed(재발송 버튼).
CREATE TABLE IF NOT EXISTS contract_agreements (
  agreement_id    text PRIMARY KEY,               -- 'agr-' + nanoid
  doc_id          text UNIQUE NOT NULL,           -- approval_docs.doc_id
  template_id     text REFERENCES agreement_templates(template_id) ON DELETE SET NULL,
  contract_id     text REFERENCES contracts(contract_id) ON DELETE SET NULL,    -- 연결 계약(선택)
  quotation_id    text,                           -- 연결 견적 quotations.quote_id(선택)
  counterparty_facility_id text REFERENCES facilities(facility_id) ON DELETE SET NULL,
  title           text NOT NULL,                  -- 계약명
  service_type    text,
  service_subtype text,
  amount_supply   bigint,                         -- 공급가
  amount_vat      bigint,
  amount_total    bigint,
  drafter_name    text,
  field_snapshot  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 승인 시점 field_values 스냅
  pdf_key         text,
  hwpx_key        text,
  generated_at    text,
  send_status     text NOT NULL DEFAULT 'draft',  -- draft|approved|sending|sent|failed
  send_error      text,
  send_attempts   integer NOT NULL DEFAULT 0,
  sent_at         text,
  sent_to         jsonb,                          -- 최근 발송 수신자 [{name,email,facilityName}] + 첨부 구성
  sent_message_id text,
  created_by      text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at      text NOT NULL,
  updated_at      text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contract_agreements_status ON contract_agreements(send_status);
CREATE INDEX IF NOT EXISTS idx_contract_agreements_counterparty
  ON contract_agreements(counterparty_facility_id);
CREATE INDEX IF NOT EXISTS idx_contract_agreements_contract ON contract_agreements(contract_id);

-- 3) 계약서 양식 시드 — 전용 작성 화면(/contracts/agreements) 사용. fields 는 양식별 문서 조회
--    표시용 최소 선언만(견적 136 관례). 실제 값 스키마는 lib/agreement/types.ts AgreementFieldValues.
--    고유 대외번호 없음(③ 확정) — doc_no_rule '계약서'로 전자결재 일반 채번만 쓴다.
INSERT INTO approval_forms
  (form_id, folder_id, name, description, fields, doc_no_rule, retention_years, org_folder, dept_folder, mobile_allowed, sort_order, created_at, updated_at)
VALUES
  ('frm-agreement', 'fld-biz', '계약서(초안 검토)', '용역 계약서 초안 — 전용 작성 화면(/contracts/agreements) 사용. 승인 완료 후 담당자가 발주처 담당자에게 수동 발송(기본 HWPX 첨부).',
   '[
     {"key":"orderer_display","label":"발주처","type":"text","row":1,"span":1},
     {"key":"amount_display","label":"계약금액","type":"text","row":1,"span":1},
     {"key":"template_display","label":"양식","type":"text","row":1,"span":1}
   ]'::jsonb,
   '계약서', 10, '계약 문서', '계약 문서', 0, 11, now()::text, now()::text)
ON CONFLICT (form_id) DO NOTHING;

INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, 1, fields, NULL, now()::text FROM approval_forms
WHERE form_id = 'frm-agreement'
ON CONFLICT (form_id, version) DO NOTHING;
