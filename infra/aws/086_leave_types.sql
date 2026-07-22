-- 086: 휴가 종류 규정 카탈로그 테이블 + 개정안 시드.
-- 사규 [별표 5. 경조금 지급 규정] 개정안 기준. ★규정 변경 대비 — 관리자가 화면에서 편집한다
-- (/approval/leave-types). 연차/반차만 deduct(대장 차감), 경조·출산·조의는 days(부여일수) 고정,
-- 공가·병가는 가변(days NULL). lib/approval/leave-types.ts DEFAULT_LEAVE_TYPES 와 일치.
-- 관례: 멱등(시드는 ON CONFLICT DO NOTHING — 관리자가 수정한 값을 재적용이 덮지 않는다).

CREATE TABLE IF NOT EXISTS leave_types (
  key text PRIMARY KEY,
  label text NOT NULL,
  group_name text NOT NULL,
  days double precision,            -- NULL = 실사용 기간만큼(가변)
  deduct text,                      -- 'full'|'half'|NULL(비차감)
  sort_order integer NOT NULL DEFAULT 0,
  active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

INSERT INTO leave_types (key, label, group_name, days, deduct, sort_order, active, created_at, updated_at) VALUES
  ('annual',                  '연차',              '연차·반차',    NULL, 'full', 0,  1, now()::text, now()::text),
  ('half_am',                 '반차(오전)',        '연차·반차',    NULL, 'half', 1,  1, now()::text, now()::text),
  ('half_pm',                 '반차(오후)',        '연차·반차',    NULL, 'half', 2,  1, now()::text, now()::text),
  ('wed_self',                '결혼(본인)',        '경조 · 결혼',   5,    NULL,   3,  1, now()::text, now()::text),
  ('wed_child',               '결혼(자녀)',        '경조 · 결혼',   1,    NULL,   4,  1, now()::text, now()::text),
  ('wed_sibling',             '결혼(형제·자매)',   '경조 · 결혼',   1,    NULL,   5,  1, now()::text, now()::text),
  ('longevity_parent',        '수연(부모)',        '경조 · 수연',   1,    NULL,   6,  1, now()::text, now()::text),
  ('longevity_parent_in_law', '수연(처·시부모)',   '경조 · 수연',   1,    NULL,   7,  1, now()::text, now()::text),
  ('longevity_self',          '수연(본인)',        '경조 · 수연',   1,    NULL,   8,  1, now()::text, now()::text),
  ('longevity_spouse',        '수연(배우자)',      '경조 · 수연',   1,    NULL,   9,  1, now()::text, now()::text),
  ('childbirth_self',         '출산(여성 본인)',   '경조 · 출산',   90,   NULL,   10, 1, now()::text, now()::text),
  ('childbirth_spouse',       '출산(배우자)',      '경조 · 출산',   20,   NULL,   11, 1, now()::text, now()::text),
  ('death_spouse',            '조의(배우자)',      '경조 · 조의',   5,    NULL,   12, 1, now()::text, now()::text),
  ('death_parent',            '조의(부모)',        '경조 · 조의',   5,    NULL,   13, 1, now()::text, now()::text),
  ('death_child',             '조의(자녀)',        '경조 · 조의',   3,    NULL,   14, 1, now()::text, now()::text),
  ('death_grandparent',       '조의(조부모)',      '경조 · 조의',   2,    NULL,   15, 1, now()::text, now()::text),
  ('death_parent_in_law',     '조의(처·시부모)',   '경조 · 조의',   3,    NULL,   16, 1, now()::text, now()::text),
  ('death_sibling',           '조의(형제·자매)',   '경조 · 조의',   1,    NULL,   17, 1, now()::text, now()::text),
  ('official_reserve',        '공가(예비군)',      '공가',         NULL, NULL,   18, 1, now()::text, now()::text),
  ('official_civil',          '공가(민방위)',      '공가',         NULL, NULL,   19, 1, now()::text, now()::text),
  ('official_checkup',        '공가(건강검진)',    '공가',         1,    NULL,   20, 1, now()::text, now()::text),
  ('sick_paid',               '병가(유급)',        '병가',         NULL, NULL,   21, 1, now()::text, now()::text),
  ('sick_injury',             '병가(산재요양)',    '병가',         NULL, NULL,   22, 1, now()::text, now()::text),
  ('etc',                     '기타',              '기타',         NULL, NULL,   23, 1, now()::text, now()::text)
ON CONFLICT (key) DO NOTHING;
