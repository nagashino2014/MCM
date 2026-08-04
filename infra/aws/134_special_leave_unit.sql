-- 134: 특별휴가 원장 확장 — 시간 단위 + 초과근무 대체휴가 자동 적재(근태 대조) 멱등 키.
-- 초과근무 대체휴가는 시간 단위로 산정된다(주 12h 초과 excess_minutes 기반). days 컬럼은
-- unit='hour' 일 때 '시간 수'로 읽는다(컬럼명 유지 — 기존 데이터·코드 호환).
-- ref_key: 자동 적재의 출처 키(예: 'ot-2026-08-02' = 해당 주 근태 대조분) — 근태 재업로드 시
-- 같은 주를 다시 산정해도 UPSERT 로 갱신될 뿐 중복 적재되지 않는다.
-- 관례: 멱등.

ALTER TABLE special_leave_ledger ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'day';    -- 'day' | 'hour'
ALTER TABLE special_leave_ledger ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'; -- 'manual' | 'auto_overtime'
ALTER TABLE special_leave_ledger ADD COLUMN IF NOT EXISTS ref_key text;                          -- 자동 적재 멱등 키

CREATE UNIQUE INDEX IF NOT EXISTS uq_special_leave_ref
  ON special_leave_ledger(employee_id, kind, ref_key) WHERE ref_key IS NOT NULL;
