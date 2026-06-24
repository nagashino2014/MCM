-- Task(계약 없는 내부 업무 단위) 보고 체계.
-- 034 위에 적용. Task = 계약처럼 공정표·수행인력·보고 이력을 갖는 1급 엔티티.
-- 업무분류(work_task_categories)별 표준공정 프리셋은 process_stage_presets(034)를 참조한다.
-- 보고는 work_plan_reports 에 contract_id XOR task_id 로 연결된다.

-- ── 1) 업무분류 ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_task_categories (
  category_id   text PRIMARY KEY,
  category_name text NOT NULL,
  preset_id     text REFERENCES process_stage_presets(preset_id) ON DELETE SET NULL,  -- 표준공정(선택)
  is_active     integer NOT NULL DEFAULT 1,
  display_order integer NOT NULL DEFAULT 100,
  created_at    text NOT NULL,
  updated_at    text NOT NULL
);

-- ── 2) Task ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_tasks (
  task_id        text PRIMARY KEY,
  task_name      text NOT NULL,
  category_id    text REFERENCES work_task_categories(category_id) ON DELETE SET NULL,
  started_at     text,                              -- 착수일 (YYYY-MM-DD)
  owning_dept_id text REFERENCES departments(dept_id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'active',    -- 'active' | 'done' | 'archived'
  created_by     text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at     text NOT NULL,
  updated_at     text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wt_category ON work_tasks(category_id);
CREATE INDEX IF NOT EXISTS idx_wt_dept     ON work_tasks(owning_dept_id);

-- ── 3) Task 공정표 (contract_process_stages 미러, 키=task_id) ────────────────
CREATE TABLE IF NOT EXISTS work_task_process_stages (
  stage_id     text PRIMARY KEY,
  task_id      text NOT NULL REFERENCES work_tasks(task_id) ON DELETE CASCADE,
  stage_order  integer NOT NULL,
  stage_code   text,
  stage_name   text NOT NULL,
  status       text NOT NULL DEFAULT 'pending',   -- 'pending' | 'in_progress' | 'done'
  planned_date text,
  actual_date  text,
  progress_pct double precision NOT NULL DEFAULT 0,
  progress_unit_pct double precision NOT NULL DEFAULT 10,
  note         text,
  created_at   text NOT NULL,
  updated_at   text NOT NULL,
  UNIQUE (task_id, stage_order)
);

CREATE INDEX IF NOT EXISTS idx_wtps_task ON work_task_process_stages(task_id);

-- ── 4) Task 수행인력 (service_participants 미러, 키=task_id) ──────────────────
CREATE TABLE IF NOT EXISTS work_task_participants (
  participation_id text PRIMARY KEY,
  task_id          text NOT NULL REFERENCES work_tasks(task_id) ON DELETE CASCADE,
  employee_id      text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  role_label       text NOT NULL DEFAULT '실무자1',   -- '관리자' | '실무자1' | '실무자2' | '실무자3' | '실무자4'
  field_label      text,
  source           text NOT NULL DEFAULT 'manual',
  created_at       text NOT NULL,
  updated_at       text NOT NULL,
  UNIQUE (task_id, employee_id, role_label)
);

CREATE INDEX IF NOT EXISTS idx_wtp_task     ON work_task_participants(task_id);
CREATE INDEX IF NOT EXISTS idx_wtp_employee ON work_task_participants(employee_id);

-- ── 5) 보고 ↔ Task 연계 ──────────────────────────────────────────────────────
ALTER TABLE work_plan_reports
  ADD COLUMN IF NOT EXISTS task_id text REFERENCES work_tasks(task_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wpr_task ON work_plan_reports(task_id);

-- ── 업무분류 5종 시드 (프리셋 미연결) ────────────────────────────────────────
INSERT INTO work_task_categories (category_id, category_name, preset_id, is_active, display_order, created_at, updated_at)
VALUES
  ('wtc-sw-dev',     'SW개발',          NULL, 1, 10, now()::text, now()::text),
  ('wtc-yearend',    '연말정산',        NULL, 1, 20, now()::text, now()::text),
  ('wtc-settlement', '결산업무',        NULL, 1, 30, now()::text, now()::text),
  ('wtc-agent-reg',  '대행업 등록 관련', NULL, 1, 40, now()::text, now()::text),
  ('wtc-vat',        '부가세 신고',      NULL, 1, 50, now()::text, now()::text)
ON CONFLICT (category_id) DO UPDATE SET
  category_name = EXCLUDED.category_name,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  updated_at = now()::text;
