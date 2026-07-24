-- 090: 초과근무 산정 제외 플래그 — 특수관계인·임원 등 초과근무 미대상 직원.
-- 데이터(출퇴근)는 보관하되 주별 초과근무 리포트·KPI 집계에서 제외한다. 관례: 멱등.
-- 화면: /approval/attendance 미매칭 매핑 탭에서 직원별 토글. 설계: docs/ADT_attendance_integration_handoff.md §7-4.

ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS overtime_excluded boolean NOT NULL DEFAULT false;
