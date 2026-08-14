-- 급여 항목 사전 보완: 장기근속휴가수당 (docs/payroll-labor-contract-blueprint.md §1-1 열 밀림 보정)
-- 최근 대장(25.04~26.07 일부)의 원본 열 라벨이 실제 기입 항목과 한 칸씩 어긋나 있었고,
-- 그 과정에서 라벨이 없던 실항목 '장기근속휴가수당'이 드러남(사용자 확인 2026-08-13).
-- 보정 매핑은 scripts/payroll_import/import_payroll.py 의 COLUMN_OVERRIDES 참조.

INSERT INTO payroll_item_defs (item_id, name, kind, aliases, in_ordinary_wage, display_order, created_at)
VALUES ('longevity', '장기근속휴가수당', 'pay', '[]'::jsonb, 0, 212, now()::text)
ON CONFLICT (item_id) DO NOTHING;
