-- 302: To-do 하위 작업 유형·종류(2026-10-20 사용자 요청·결정).
--   유형(todo_work_types) — 통합허가·화관법·HAPs·ESG·영업·인사회계·SW개발·기타. 기본 8종은 type_key 가 고정이라
--     이름을 바꿔도 자동 매칭(계약 대분류·영업·업무추진계획 Task)이 유지된다. 관리자가 유형 추가·이름변경·숨김.
--   종류(todo_milestone_kinds) — 유형별 목록. 사전협의·본협의·검토결과서 수령은 통합허가에만. 같은 kind_key 를 여러 유형이 공유할 수 있다.
--   todo_items.work_type — 하위 작업의 직접 선택 유형(상위 '관련'이 계약·영업·업무추진계획이면 화면이 자동 값을 쓰고 이 값은 무시).
--   milestone_kind CHECK(287) 해제 — 관리자가 추가한 종류 키(mk_...)를 저장할 수 있게.
--   '실제일 → 종료일'(결정: 종료일 = 기간 종료 end_date, actual_date 는 공정표 역동기화용 내부 값으로 유지):
--     기존 하위 작업의 actual_date 를 시작일·종료일로 옮긴다(시작일 없으면 시작일, 시작일 이후면 비어 있는 종료일).
--   선행: 287. GRANT 없음(265 default privileges). 멱등.

CREATE TABLE IF NOT EXISTS todo_work_types (
  type_key    text PRIMARY KEY,
  label       text NOT NULL,
  builtin     integer NOT NULL DEFAULT 0,
  sort_order  integer NOT NULL DEFAULT 100,
  is_active   integer NOT NULL DEFAULT 1,
  created_at  text NOT NULL,
  updated_at  text NOT NULL
);

CREATE TABLE IF NOT EXISTS todo_milestone_kinds (
  type_key    text NOT NULL REFERENCES todo_work_types(type_key) ON DELETE CASCADE,
  kind_key    text NOT NULL,
  label       text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 100,
  is_active   integer NOT NULL DEFAULT 1,
  created_at  text NOT NULL,
  updated_at  text NOT NULL,
  PRIMARY KEY (type_key, kind_key)
);

ALTER TABLE todo_items ADD COLUMN IF NOT EXISTS work_type text;

ALTER TABLE todo_items DROP CONSTRAINT IF EXISTS todo_items_milestone_kind_check;

-- 기본 유형 8종(이미 있으면 이름·순서는 관리자 값 유지)
INSERT INTO todo_work_types (type_key, label, builtin, sort_order, is_active, created_at, updated_at)
SELECT v.type_key, v.label, 1, v.sort_order, 1, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES
    ('permit', '통합허가', 10),
    ('chem', '화관법', 20),
    ('haps', 'HAPs', 30),
    ('esg', 'ESG', 40),
    ('sales', '영업', 50),
    ('hr_acct', '인사회계', 60),
    ('sw', 'SW개발', 70),
    ('etc', '기타', 80)
  ) AS v(type_key, label, sort_order)
ON CONFLICT (type_key) DO NOTHING;

-- 기본 종류 — 통합허가 전용 3종 + 전 유형 공통 5종(기존 287 키 그대로)
INSERT INTO todo_milestone_kinds (type_key, kind_key, label, sort_order, is_active, created_at, updated_at)
SELECT 'permit', v.kind_key, v.label, v.sort_order, 1, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES
    ('pre_consult', '사전협의 제출', 10),
    ('main_consult', '본협의 제출', 20),
    ('review_received', '검토결과서 수령', 30)
  ) AS v(kind_key, label, sort_order)
ON CONFLICT (type_key, kind_key) DO NOTHING;

INSERT INTO todo_milestone_kinds (type_key, kind_key, label, sort_order, is_active, created_at, updated_at)
SELECT t.type_key, v.kind_key, v.label, v.sort_order, 1, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM todo_work_types t
 CROSS JOIN (VALUES
    ('meeting', '미팅', 40),
    ('kickoff_report', '착수보고', 50),
    ('completion_report', '준공보고', 60),
    ('submit', '제출', 70),
    ('other', '기타', 90)
  ) AS v(kind_key, label, sort_order)
 WHERE t.builtin = 1
ON CONFLICT (type_key, kind_key) DO NOTHING;

-- 실제일 → 시작일·종료일(하위 작업만, 한 번만 의미 있음 — 재실행해도 이미 채워진 값은 건드리지 않는다)
UPDATE todo_items
   SET do_date = actual_date
 WHERE parent_item_id IS NOT NULL AND actual_date IS NOT NULL AND do_date IS NULL;

UPDATE todo_items
   SET end_date = actual_date
 WHERE parent_item_id IS NOT NULL AND actual_date IS NOT NULL AND end_date IS NULL
   AND do_date IS NOT NULL AND actual_date > do_date;
