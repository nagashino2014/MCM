-- 업무보고 제출 시 자동 집계되는 용역 추진경과 로그. (정규화 파이프라인)
-- 027/029 위에 적용. 보고서 제출(status='submitted') 시 항목의 진행내역을 적재하고,
-- 담당자를 service_participants(source='work_plan')로 누적한다.
-- (report_id, contract_id) 복합 유니크로 멱등 — 재제출 시 갱신만.

CREATE TABLE IF NOT EXISTS contract_progress_log (
  log_id         text PRIMARY KEY,
  contract_id    text NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
  report_id      text NOT NULL REFERENCES work_plan_reports(report_id) ON DELETE CASCADE,
  item_id        text REFERENCES work_plan_items(item_id) ON DELETE SET NULL,
  period_start   text,
  period_end     text,
  progress_text  text,
  plan_text      text,
  status_text    text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL,
  UNIQUE (report_id, contract_id)
);

CREATE INDEX IF NOT EXISTS idx_cpl_contract ON contract_progress_log(contract_id);
CREATE INDEX IF NOT EXISTS idx_cpl_report   ON contract_progress_log(report_id);
