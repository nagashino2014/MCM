-- 업무추진계획(전자 업무보고) 코어 스키마. (PR-1)
-- 026 위에 적용. 표준 모델 = 보고서(work_plan_reports) × 항목(work_plan_items) + 양식(work_plan_templates).
-- 담당자/참여자는 로그인 계정(users)이 아니라 조직 인원(employee_profiles) 기준으로 저장한다.
-- 머지(report_kind/parent/merge_locked_at)·진행단계(progress_*)·외부마스터 link 컬럼은
-- 후속 PR(머지·진행단계·영업관리)을 위해 미리 두되, PR-1 화면에서는 기본 작성만 사용한다.

CREATE TABLE IF NOT EXISTS work_plan_templates (
  template_id         text PRIMARY KEY,
  template_name       text NOT NULL,
  unit_type           text NOT NULL,                 -- 'service' | 'task' | 'category' | 'narrative' | 'sales' | 'admin_task'
  schema_json         jsonb,                          -- 항목별 라벨/필수/UI 힌트
  default_for_dept_id text REFERENCES departments(dept_id) ON DELETE SET NULL,
  is_active           integer NOT NULL DEFAULT 1,
  display_order       integer NOT NULL DEFAULT 100,
  created_at          text NOT NULL,
  updated_at          text NOT NULL
);

CREATE TABLE IF NOT EXISTS work_plan_reports (
  report_id        text PRIMARY KEY,
  dept_id          text NOT NULL REFERENCES departments(dept_id) ON DELETE CASCADE,
  template_id      text REFERENCES work_plan_templates(template_id) ON DELETE SET NULL,
  report_period    text NOT NULL DEFAULT 'weekly',    -- 'weekly' | 'biweekly' | 'monthly'
  period_start     text NOT NULL,                     -- YYYY-MM-DD
  period_end       text NOT NULL,                     -- YYYY-MM-DD
  report_date      text,                              -- 보고 회의 일자
  meeting_type     text NOT NULL DEFAULT 'weekly',    -- 'weekly' | 'exec_briefing'
  report_kind      text NOT NULL DEFAULT 'dept_consolidated', -- (PR-3) 'staff_input' | 'dept_consolidated' | 'meeting_briefing'
  parent_report_id text REFERENCES work_plan_reports(report_id) ON DELETE SET NULL, -- (PR-3)
  status           text NOT NULL DEFAULT 'draft',     -- 'draft' | 'submitted' | 'reviewed' | 'finalized'
  title            text,                              -- 표시용 제목(선택, 미입력 시 부서+기간으로 합성)
  author_user_id   text REFERENCES users(user_id) ON DELETE SET NULL,
  reviewed_by      text REFERENCES users(user_id) ON DELETE SET NULL,
  merge_locked_at  text,                              -- (PR-3) 머지 완료 잠금
  finalized_at     text,
  created_at       text NOT NULL,
  updated_at       text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wpr_dept   ON work_plan_reports(dept_id);
CREATE INDEX IF NOT EXISTS idx_wpr_period ON work_plan_reports(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_wpr_status ON work_plan_reports(status);
CREATE INDEX IF NOT EXISTS idx_wpr_parent ON work_plan_reports(parent_report_id);

CREATE TABLE IF NOT EXISTS work_plan_items (
  item_id              text PRIMARY KEY,
  report_id            text NOT NULL REFERENCES work_plan_reports(report_id) ON DELETE CASCADE,
  display_order        integer NOT NULL DEFAULT 100,
  -- 4요소 (모든 양식 공통)
  category             text,                          -- '영업'|'관리'|'완료'|'실행' 등 양식별 구분
  subject_kind         text NOT NULL DEFAULT 'free',  -- 'contract'|'facility'|'task'|'sales'|'admin_task'|'free'
  contract_id          text REFERENCES contracts(contract_id) ON DELETE SET NULL,
  facility_id          text REFERENCES facilities(facility_id) ON DELETE SET NULL,
  subject_label        text,                          -- 자유 캡션(사업장명/용역명)
  -- 본문
  progress_text        text,                          -- 추진내역(이번 주)
  plan_text            text,                          -- 추진계획(다음 주)
  status_text          text,                          -- 진행상황
  -- 진행단계 (PR-2)
  progress_stage       text,
  progress_pct         double precision,
  key_dates_json       jsonb,
  -- 참여 인력 (employee_profiles 기준)
  manager_employee_id   text REFERENCES employee_profiles(employee_id) ON DELETE SET NULL, -- 관리자/총괄
  primary_employee_id   text REFERENCES employee_profiles(employee_id) ON DELETE SET NULL, -- 정 담당
  secondary_employee_id text REFERENCES employee_profiles(employee_id) ON DELETE SET NULL, -- 부 담당
  participants_json     jsonb,                         -- [{employeeId, role}]
  milestones_json       jsonb,                         -- [{period:'2026-05', label:'계약완료'}]
  remarks               text,
  -- 외부 마스터 link (PR-4 영업·관리)
  linked_sales_activity_id text,
  linked_bid_record_id     text,
  linked_admin_task_id     text,
  -- 1차/머지 (PR-3)
  source_item_id        text REFERENCES work_plan_items(item_id) ON DELETE SET NULL,
  item_status           text NOT NULL DEFAULT 'draft', -- 'draft'|'submitted'|'merged'|'edited_by_dept_head'
  author_user_id        text REFERENCES users(user_id) ON DELETE SET NULL,
  -- 잠금 상태 수정 메타 (3.2.7)
  last_locked_edit_at     text,
  last_locked_edit_by     text REFERENCES users(user_id) ON DELETE SET NULL,
  last_locked_edit_reason text,
  created_at            text NOT NULL,
  updated_at            text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wpi_report    ON work_plan_items(report_id);
CREATE INDEX IF NOT EXISTS idx_wpi_contract  ON work_plan_items(contract_id);
CREATE INDEX IF NOT EXISTS idx_wpi_facility  ON work_plan_items(facility_id);
CREATE INDEX IF NOT EXISTS idx_wpi_primary   ON work_plan_items(primary_employee_id);
CREATE INDEX IF NOT EXISTS idx_wpi_secondary ON work_plan_items(secondary_employee_id);
CREATE INDEX IF NOT EXISTS idx_wpi_source    ON work_plan_items(source_item_id);

-- 표준 양식 시드 (PR-1 우선 4종). 부서-템플릿 추천은 화면에서 unit_type 으로 선택.
INSERT INTO work_plan_templates (template_id, template_name, unit_type, schema_json, default_for_dept_id, is_active, display_order, created_at, updated_at)
VALUES
  ('tpl-service-matrix',  '사업장×용역 매트릭스 (통합본부·울산지사)', 'service',
     '{"columns":["subject_label","status_text","progress_text","plan_text","manager","primary","secondary"],"required":["subject_label"]}'::jsonb,
     NULL, 1, 10, now()::text, now()::text),
  ('tpl-chemsafe-matrix', '사업장×용역 매트릭스 (화학안전본부)', 'service',
     '{"columns":["subject_label","status_text","progress_text","plan_text","manager","primary"],"required":["subject_label"]}'::jsonb,
     NULL, 1, 20, now()::text, now()::text),
  ('tpl-task-matrix',     '작업 단위 (도면관리)', 'task',
     '{"columns":["category","subject_label","progress_text","status_text","primary","remarks"],"required":["subject_label"],"categories":["완료","실행","보완"]}'::jsonb,
     NULL, 1, 30, now()::text, now()::text),
  ('tpl-category-bullets','자유 서술 (연구소·영업관리)', 'category',
     '{"columns":["category","subject_label","progress_text","plan_text"],"required":["category"]}'::jsonb,
     NULL, 1, 40, now()::text, now()::text)
ON CONFLICT (template_id) DO UPDATE SET
  template_name = EXCLUDED.template_name,
  unit_type = EXCLUDED.unit_type,
  schema_json = EXCLUDED.schema_json,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  updated_at = now()::text;
