-- 112: 홈 화면 사용자 설정(HC-B) — 카드 표시/비표시·배치(위치·크기)와 캘린더 참조 인원.
-- 홈 편집 모드에서 저장하며 기기와 무관하게 사용자를 따라간다(브라우저 로컬 저장이 아님).
--   layout        : { "hidden": ["billing"], "items": { "workPlan": { "x":0,"y":0,"w":4,"h":1 } } }
--                   x/w 는 12열 그리드 기준, y 는 행 순서, h 는 행 높이 배수.
--   calendar_refs : 캘린더 '선택' 태그로 표시할 인원(참조 지정, 최대 10명) — employee_id 배열.
--   calendar_tags : 켜둔 태그 목록(["self","sales",...]) — 다음 접속에도 유지.
-- 고정 영역(KPI 4종·결재 대기·안읽은 메일·캘린더)은 배치 대상이 아니라 items 에 들어오지 않는다.
-- 관례: 멱등.

CREATE TABLE IF NOT EXISTS home_layouts (
  user_id       text PRIMARY KEY,
  layout        jsonb NOT NULL DEFAULT '{}'::jsonb,
  calendar_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  calendar_tags jsonb NOT NULL DEFAULT '["self","sales"]'::jsonb,
  updated_at    text  NOT NULL
);

COMMENT ON TABLE home_layouts IS '홈 화면 사용자별 카드 표시/배치 설정(HC-B)';
