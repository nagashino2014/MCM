-- 역할 기반 업무보고: 이슈상황(수행자 보고 + 부서장 대응방안) + 지시(부서장/임원).
-- 027/030 위에 적용.

-- 1) 이슈상황 — 수행자가 보고하고 부서장이 대응방안을 입력한다.
CREATE TABLE IF NOT EXISTS work_plan_issues (
  issue_id      text PRIMARY KEY,
  contract_id   text REFERENCES contracts(contract_id) ON DELETE CASCADE,
  item_id       text REFERENCES work_plan_items(item_id) ON DELETE SET NULL,
  issue_kind    text NOT NULL,                    -- 'contact_change'|'accident'|'doc_missing'|'permit_condition'|'schedule_delay'|'other'
  title         text,
  description   text,                              -- 수행자 서술
  occurred_on   text,                              -- 발생일 (YYYY-MM-DD)
  severity      text NOT NULL DEFAULT 'warn',      -- 'info'|'warn'|'critical'
  -- 부서장 대응방안
  response_plan text,
  responded_by  text REFERENCES users(user_id) ON DELETE SET NULL,
  responded_at  text,
  status        text NOT NULL DEFAULT 'open',      -- 'open'|'in_progress'|'resolved'
  created_by    text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at    text NOT NULL,
  updated_at    text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wpi_issue_contract ON work_plan_issues(contract_id);
CREATE INDEX IF NOT EXISTS idx_wpi_issue_status   ON work_plan_issues(status);

-- 2) 지시 — 부서장(수행자 대상) / 임원(부서장 대상). 기록 보존 + 상태 추적.
CREATE TABLE IF NOT EXISTS work_plan_directives (
  directive_id    text PRIMARY KEY,
  report_id       text REFERENCES work_plan_reports(report_id) ON DELETE CASCADE,
  contract_id     text REFERENCES contracts(contract_id) ON DELETE SET NULL,
  item_id         text REFERENCES work_plan_items(item_id) ON DELETE SET NULL,
  level           text NOT NULL,                  -- 'dept_head'(부서장→수행자) | 'exec'(임원→부서장)
  kind            text NOT NULL,                  -- 'supplement_request'|'expedite'|'additional_report'|'opinion'|'confirm'
  message         text,
  issued_by       text REFERENCES users(user_id) ON DELETE SET NULL,
  issued_to       text REFERENCES users(user_id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'open',   -- 'open'|'acknowledged'|'resolved'
  created_at      text NOT NULL,
  acknowledged_at text,
  resolved_at     text
);

CREATE INDEX IF NOT EXISTS idx_wpd_report ON work_plan_directives(report_id);
CREATE INDEX IF NOT EXISTS idx_wpd_to     ON work_plan_directives(issued_to, status);
