-- 업무추진계획 = 용역 기반 업무보고 워크스페이스 개편.
-- 030(공정표)·027(보고)·029(수행인력) 위에 적용.
-- 1) 공정 프리셋(선택/추가 대상) + 단계별 진행율 단위, 2) 계약 공정 단계에 진행율 단위,
-- 3) 보고↔용역 연계 + 회의종류, 4) 보고별 공정 진행 델타(인포그래픽 색상 근거).

-- ── 1) 공정 프리셋 ─────────────────────────────────────────────────────────
-- 공정표 설정 모달에서 선택/추가하는 표준 공정 묶음. 엑셀 일괄 import 도 같은 테이블에 적재.
CREATE TABLE IF NOT EXISTS process_stage_presets (
  preset_id     text PRIMARY KEY,
  preset_name   text NOT NULL,
  service_type  text,                              -- '통합허가' 등 contracts.service_type 와 매칭(선택)
  is_active     integer NOT NULL DEFAULT 1,
  display_order integer NOT NULL DEFAULT 100,
  created_at    text NOT NULL,
  updated_at    text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_psp_service ON process_stage_presets(service_type);

CREATE TABLE IF NOT EXISTS process_stage_preset_items (
  item_id          text PRIMARY KEY,
  preset_id        text NOT NULL REFERENCES process_stage_presets(preset_id) ON DELETE CASCADE,
  stage_order      integer NOT NULL,
  stage_code       text,
  stage_name       text NOT NULL,
  progress_unit_pct double precision NOT NULL DEFAULT 10,  -- 슬라이더 1스텝 진행율 단위
  is_active        integer NOT NULL DEFAULT 1,
  created_at       text NOT NULL,
  updated_at       text NOT NULL,
  UNIQUE (preset_id, stage_order)
);

CREATE INDEX IF NOT EXISTS idx_pspi_preset ON process_stage_preset_items(preset_id);

-- ── 2) 계약 공정 단계에 진행율 단위 ────────────────────────────────────────
ALTER TABLE contract_process_stages
  ADD COLUMN IF NOT EXISTS progress_unit_pct double precision NOT NULL DEFAULT 10;

-- ── 3) 보고↔용역 연계 + 회의 종류 ──────────────────────────────────────────
ALTER TABLE work_plan_reports
  ADD COLUMN IF NOT EXISTS contract_id text REFERENCES contracts(contract_id) ON DELETE SET NULL;
ALTER TABLE work_plan_reports
  ADD COLUMN IF NOT EXISTS meeting_label text;   -- '주간회의' | '간부간담회' 등 자유 텍스트

CREATE INDEX IF NOT EXISTS idx_wpr_contract ON work_plan_reports(contract_id);

-- ── 4) 보고별 공정 진행 델타 ───────────────────────────────────────────────
-- 이 보고 기간 동안 진행중/완료로 기록한 공정 단계. 계약 공정표는 교체(DELETE+INSERT)되므로
-- stage_id 대신 stage_order 스냅샷으로 매핑한다.
CREATE TABLE IF NOT EXISTS work_plan_report_stages (
  row_id       text PRIMARY KEY,
  report_id    text NOT NULL REFERENCES work_plan_reports(report_id) ON DELETE CASCADE,
  stage_order  integer NOT NULL,
  stage_code   text,
  stage_name   text NOT NULL,
  status       text NOT NULL DEFAULT 'in_progress',   -- 'in_progress' | 'done'
  progress_pct double precision NOT NULL DEFAULT 0,
  planned_date text,                                   -- 착수일 (YYYY-MM-DD)
  actual_date  text,                                   -- 완료일 (YYYY-MM-DD)
  created_at   text NOT NULL,
  updated_at   text NOT NULL,
  UNIQUE (report_id, stage_order)
);

CREATE INDEX IF NOT EXISTS idx_wprs_report ON work_plan_report_stages(report_id);

-- ── 기본 프리셋 시드: 통합허가 9단계(030 표준 공정과 동일) ──────────────────
INSERT INTO process_stage_presets (preset_id, preset_name, service_type, is_active, display_order, created_at, updated_at)
VALUES ('psp-integrated-permit', '통합허가 표준 공정', '통합허가', 1, 10, now()::text, now()::text)
ON CONFLICT (preset_id) DO UPDATE SET
  preset_name = EXCLUDED.preset_name,
  service_type = EXCLUDED.service_type,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  updated_at = now()::text;

INSERT INTO process_stage_preset_items (item_id, preset_id, stage_order, stage_code, stage_name, progress_unit_pct, is_active, created_at, updated_at)
VALUES
  ('pspi-ip-1', 'psp-integrated-permit', 1, 'contract',        '계약',       10, 1, now()::text, now()::text),
  ('pspi-ip-2', 'psp-integrated-permit', 2, 'kickoff',         '착수회의',   10, 1, now()::text, now()::text),
  ('pspi-ip-3', 'psp-integrated-permit', 3, 'site_diagnosis',  '현장진단',   25, 1, now()::text, now()::text),
  ('pspi-ip-4', 'psp-integrated-permit', 4, 'data_analysis',   '자료분석',   10, 1, now()::text, now()::text),
  ('pspi-ip-5', 'psp-integrated-permit', 5, 'plan_drafting',   '계획서작성',  5, 1, now()::text, now()::text),
  ('pspi-ip-6', 'psp-integrated-permit', 6, 'pre_consult',     '사전협의',   10, 1, now()::text, now()::text),
  ('pspi-ip-7', 'psp-integrated-permit', 7, 'main_consult',    '본협의',     10, 1, now()::text, now()::text),
  ('pspi-ip-8', 'psp-integrated-permit', 8, 'permit_acquired', '허가취득',   10, 1, now()::text, now()::text),
  ('pspi-ip-9', 'psp-integrated-permit', 9, 'post_mgmt',       '사후관리',   10, 1, now()::text, now()::text)
ON CONFLICT (preset_id, stage_order) DO UPDATE SET
  stage_code = EXCLUDED.stage_code,
  stage_name = EXCLUDED.stage_name,
  progress_unit_pct = EXCLUDED.progress_unit_pct,
  is_active = EXCLUDED.is_active,
  updated_at = now()::text;
