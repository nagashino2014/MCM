-- 164: 급여명세서 개인 발송 이력 (2026-08-14, 블루프린트 §4-1 후속)
-- 근로기준법 제48조② 임금명세서 교부 의무 — 사내 전산망(앱 수신함) 교부 + 메일 알림.
-- 명세서 PDF는 확정 대장 라인에서 온디맨드 렌더하므로 파일은 저장하지 않고 발송 시각만 기록한다.
ALTER TABLE payroll_entries ADD COLUMN IF NOT EXISTS statement_sent_at text;
CREATE INDEX IF NOT EXISTS idx_payroll_entries_stmt_sent ON payroll_entries(employee_id, statement_sent_at);
