-- 142: 착수계·준공계 작성 시스템 — 발주처 자체양식 템플릿 + 작성 문서 대장.
-- 설계: docs/contract-deliverables-blueprint.md (2026-08-07 확정: 결재는 공문 결재로 갈음,
--       메뉴는 계약(/contracts/deliverables), 기본 카탈로그 6종, 산출물 PDF+HWPX,
--       양식 분석 입력 HWPX/DOCX/스캔 PDF).
-- 공문(135)·견적서(136)와 달리 approval_docs 를 원본으로 쓰지 않는다 — 결재를 태우지 않으므로
-- contract_deliverables.field_values 자체가 문서 원본이고, 완성 산출물은 공문의 첨부로 실려 나간다.
-- 관례: text 타임스탬프, integer boolean, 멱등(IF NOT EXISTS / ON CONFLICT).

-- 1) 발주처 자체양식 템플릿 — 자기네 양식을 고집하는 발주처용. AI 분석(HWPX/DOCX/스캔 PDF)
--    결과를 DeliverableSpec[] 로 저장하고, 웹 편집기(D5)가 이 spec 을 다듬는다.
--    기본양식은 코드 상수(lib/deliverable/catalog.ts)이므로 이 테이블에 넣지 않는다.
CREATE TABLE IF NOT EXISTS deliverable_templates (
  template_id     text PRIMARY KEY,               -- 'dtpl-' + nanoid
  name            text NOT NULL,                  -- '인천공항에너지 준공 서류' 등 사용자 지정
  kind            text NOT NULL,                  -- 'start' | 'completion'
  -- 이 양식을 요구하는 발주처 = 계약상대 업체(contracts.counterparty_facility_id 와 같은 축)
  owner_facility_id text REFERENCES facilities(facility_id) ON DELETE SET NULL,
  source_kind     text,                           -- hwpx | docx | pdf (업로드 원본 형식)
  source_key      text,                           -- S3 원본 보관 키(재분석용)
  source_pages    integer,
  spec            jsonb NOT NULL DEFAULT '[]'::jsonb,  -- DeliverableSpec[] (서식 여러 장)
  analyzed_at     text,
  analyze_model   text,
  analyze_note    text,                           -- 분석 시 LLM 이 남긴 주의사항·미확신 항목
  created_by      text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at      text NOT NULL,
  updated_at      text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deliverable_templates_owner
  ON deliverable_templates(owner_facility_id, kind);

-- 2) 작성된 착수계·준공계 — 계약 1건에 여러 벌(착수/준공, 재작성) 가능.
--    field_values 는 바인딩 키(lib/deliverable/types.ts DELIVERABLE_BINDINGS) → 확정값 맵이고,
--    unlocked 는 자동 채움값 중 사용자가 잠금 해제해 직접 수정한 키 목록이다.
CREATE TABLE IF NOT EXISTS contract_deliverables (
  deliverable_id text PRIMARY KEY,                -- 'dlv-' + nanoid
  contract_id    text NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
  kind           text NOT NULL,                   -- 'start' | 'completion'
  template_id    text REFERENCES deliverable_templates(template_id) ON DELETE SET NULL,  -- NULL = 기본양식
  doc_types      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- 생성할 서식 키 배열(순서 = 페이지 순서)
  title          text NOT NULL,                   -- 목록 표기용(보통 계약명 + 종류)
  field_values   jsonb NOT NULL DEFAULT '{}'::jsonb,
  unlocked       jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_key        text,
  hwpx_key       text,
  generated_at   text,
  letter_doc_id  text,                            -- 연계 공문 approval_docs.doc_id
  letter_no      text,                            -- 발송 완료 시 시행 번호 스냅샷
  status         text NOT NULL DEFAULT 'draft',   -- draft | ready | attached | sent
  drafter_name   text,
  created_by     text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at     text NOT NULL,
  updated_at     text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contract_deliverables_contract
  ON contract_deliverables(contract_id, kind);
CREATE INDEX IF NOT EXISTS idx_contract_deliverables_status
  ON contract_deliverables(status);
CREATE INDEX IF NOT EXISTS idx_contract_deliverables_letter
  ON contract_deliverables(letter_doc_id);
