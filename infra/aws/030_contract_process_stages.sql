-- 용역 공정표(진행 단계) — 표준 템플릿 + 계약별 공정.
-- 027/029 위에 적용. 계약별 공정표는 용역분류별 표준에서 생성 후 계약마다 가감한다.
-- 업무보고 시 각 보고가 어느 단계까지 진행됐는지를 이 공정에 매핑한다.

-- 1) 표준 공정 템플릿 (용역분류별 단계 묶음)
CREATE TABLE IF NOT EXISTS process_stage_templates (
  row_id       text PRIMARY KEY,
  service_type text NOT NULL,            -- '통합허가' 등 contracts.service_type 과 매칭
  stage_order  integer NOT NULL,
  stage_code   text NOT NULL,
  stage_name   text NOT NULL,
  is_active    integer NOT NULL DEFAULT 1,
  created_at   text NOT NULL,
  updated_at   text NOT NULL,
  UNIQUE (service_type, stage_order)
);

CREATE INDEX IF NOT EXISTS idx_pst_service ON process_stage_templates(service_type);

-- 2) 계약별 공정표
CREATE TABLE IF NOT EXISTS contract_process_stages (
  stage_id     text PRIMARY KEY,
  contract_id  text NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
  stage_order  integer NOT NULL,
  stage_code   text,
  stage_name   text NOT NULL,
  status       text NOT NULL DEFAULT 'pending',   -- 'pending' | 'in_progress' | 'done'
  planned_date text,                                -- 예정일 (YYYY-MM-DD)
  actual_date  text,                                -- 완료/실제 진행일
  progress_pct double precision NOT NULL DEFAULT 0, -- 단계 내 진행률 0~100
  note         text,                                -- 활동 메모 (예: '대기·수질 현장 실측')
  created_at   text NOT NULL,
  updated_at   text NOT NULL,
  UNIQUE (contract_id, stage_order)
);

CREATE INDEX IF NOT EXISTS idx_cps_contract ON contract_process_stages(contract_id);

-- 3) 통합허가 표준 공정 9단계 시드
INSERT INTO process_stage_templates (row_id, service_type, stage_order, stage_code, stage_name, is_active, created_at, updated_at)
VALUES
  ('pst-tp-1', '통합허가', 1, 'contract',        '계약',       1, now()::text, now()::text),
  ('pst-tp-2', '통합허가', 2, 'kickoff',         '착수회의',   1, now()::text, now()::text),
  ('pst-tp-3', '통합허가', 3, 'site_diagnosis',  '현장진단',   1, now()::text, now()::text),
  ('pst-tp-4', '통합허가', 4, 'data_analysis',   '자료분석',   1, now()::text, now()::text),
  ('pst-tp-5', '통합허가', 5, 'plan_drafting',   '계획서작성', 1, now()::text, now()::text),
  ('pst-tp-6', '통합허가', 6, 'pre_consult',     '사전협의',   1, now()::text, now()::text),
  ('pst-tp-7', '통합허가', 7, 'main_consult',    '본협의',     1, now()::text, now()::text),
  ('pst-tp-8', '통합허가', 8, 'permit_acquired', '허가취득',   1, now()::text, now()::text),
  ('pst-tp-9', '통합허가', 9, 'post_mgmt',       '사후관리',   1, now()::text, now()::text)
ON CONFLICT (service_type, stage_order) DO UPDATE SET
  stage_code = EXCLUDED.stage_code,
  stage_name = EXCLUDED.stage_name,
  is_active = EXCLUDED.is_active,
  updated_at = now()::text;
