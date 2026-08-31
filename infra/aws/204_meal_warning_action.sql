-- 204: 식대 부당 사용 관리자 처분 (2026-08-27 확정 — 203 후속)
-- 위반 1~2회는 경고로 처리하되, 반복되면 관리자가 불지급·급여 차감 조치를 할 수 있어야 한다.
-- ① overtime_meal_warnings 에 처분 컬럼: 기본 'warning'(경고). 관리자가 근태 관리 화면
--    "식대 경고" 탭에서 건별로 지정한다(/api/payroll/meal-warnings).
--    · warning  : 경고(기본) — 급여 영향 없음
--    · withhold : 불지급 — 개인영수증 환급 제외 등 지급 단계에서 제외(급여 라인 없음, 기록·표시)
--    · deduct   : 급여 차감 — 사용액을 급여대장 공제('식대환수')로 자동 반영(buildLedger)
-- ② payroll_item_defs 에 공제 항목 '식대환수'(meal-clawback) 시드.
ALTER TABLE overtime_meal_warnings ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'warning';
ALTER TABLE overtime_meal_warnings ADD COLUMN IF NOT EXISTS action_note text;
ALTER TABLE overtime_meal_warnings ADD COLUMN IF NOT EXISTS action_by text;
ALTER TABLE overtime_meal_warnings ADD COLUMN IF NOT EXISTS action_at text;

-- 급여대장 생성 시 deduct 합산 조회용
CREATE INDEX IF NOT EXISTS idx_omw_action ON overtime_meal_warnings (action, used_on);

INSERT INTO payroll_item_defs (item_id, name, kind, aliases, in_ordinary_wage, display_order)
VALUES ('meal-clawback', '식대환수', 'deduction', '[]'::jsonb, 0, 680)
ON CONFLICT (item_id) DO NOTHING;
