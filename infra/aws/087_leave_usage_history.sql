-- 087: 직원별 휴가 관리 개편(LM-P3) — 연차 대장을 날짜별 이력 기반으로 확장.
-- ①annual_leave_ledger 에 used_on(사용일)·leave_type_key(휴가 종류) 추가:
--   사용(use) 엔트리를 "날짜 1건 = 1행"으로 관리하고 연차 외 휴가도 use 로 기록한다
--   (차감 여부는 leave_types.deduct 로 판정 — 비차감이면 잔여 미반영, 현황 표시용).
-- ②leave_settings: 연차 발생 기준(회계연도 1/1 vs 입사일) 설정.
-- 설계: docs/leave-management-blueprint.md §3. 관례: 멱등.

ALTER TABLE annual_leave_ledger ADD COLUMN IF NOT EXISTS used_on text;        -- YYYY-MM-DD (use 만, grant/adjust 는 NULL)
ALTER TABLE annual_leave_ledger ADD COLUMN IF NOT EXISTS leave_type_key text; -- leave_types.key (use 의 휴가 종류)

CREATE INDEX IF NOT EXISTS idx_annual_leave_used_on ON annual_leave_ledger(employee_id, used_on);
CREATE INDEX IF NOT EXISTS idx_annual_leave_type ON annual_leave_ledger(leave_type_key);

-- 연차 발생 기준 설정(단일 행 'default')
CREATE TABLE IF NOT EXISTS leave_settings (
  id text PRIMARY KEY DEFAULT 'default',
  accrual_basis text NOT NULL DEFAULT 'jan1',   -- 'jan1'(회계연도 1/1) | 'hire_date'(입사일 기준)
  updated_at text NOT NULL
);
INSERT INTO leave_settings (id, accrual_basis, updated_at)
VALUES ('default', 'jan1', now()::text)
ON CONFLICT (id) DO NOTHING;
