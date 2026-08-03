-- 125: 일정 메뉴(G6-C, /calendar) 사용자 설정 — 켜둔 태그 + '선택' 대상(개인/부서/전사).
-- 홈 위젯의 home_layouts.calendar_refs(최대 10명)와 분리 — 일정 메뉴는 무제한·부서/전사 일괄 지원.
-- refs 는 선택 "조건"(employeeIds/deptIds/all)을 저장하고 조회 시점에 인원으로 확장한다
-- (부서 인사이동이 자동 반영된다). 신규 권한키 없음 — 열람은 로그인만(requireSession),
-- 영업 태그는 기존 sales.view 를 재사용한다. 멱등.

CREATE TABLE IF NOT EXISTS calendar_prefs (
  user_id    text PRIMARY KEY,
  tags       jsonb NOT NULL DEFAULT '["self","dept"]'::jsonb,
  refs       jsonb NOT NULL DEFAULT '{"employeeIds":[],"deptIds":[],"all":false}'::jsonb,
  updated_at text  NOT NULL
);
COMMENT ON TABLE calendar_prefs IS '일정 메뉴 사용자별 태그·선택 인원 설정(G6-C)';
