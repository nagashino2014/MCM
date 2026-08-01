-- 114: 시맨틱 개념 사전(semantic_concepts) — 양식 필드에 "데이터 의미"를 부여하는 표준 태그 카탈로그.
-- 설계: docs/semantic-analytics-wizard-blueprint.md §4-1 (SW-P0).
-- 지표(metric)는 필드 key 가 아니라 이 개념 태그를 참조한다 — 양식이 바뀌어도 태그만 붙이면
-- 기존 지표가 동작(SaaS 커스터마이즈의 핵심). 엔티티 참조 4종(ref.*)은 필드 타입에서 자동 태깅되며
-- auto=1 로 표시(빌더 드롭다운에는 노출하지 않고 라벨 표시에만 사용).
-- applies_to = 태그를 붙일 수 있는 필드/표 열 타입 목록(콤마 구분).
-- 관례: 멱등(시드는 ON CONFLICT DO NOTHING — 관리자가 수정한 값을 재적용이 덮지 않는다).
-- lib/approval/semantic-concepts.ts DEFAULT_SEMANTIC_CONCEPTS 와 일치.

CREATE TABLE IF NOT EXISTS semantic_concepts (
  key text PRIMARY KEY,
  label text NOT NULL,
  group_name text NOT NULL,
  applies_to text NOT NULL DEFAULT '',  -- 콤마 구분 필드 타입 목록. auto 개념은 해당 select 타입 1개
  auto integer NOT NULL DEFAULT 0,      -- 1 = 필드 타입에서 자동 부여(빌더 수동 선택 대상 아님)
  sort_order integer NOT NULL DEFAULT 0,
  active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

INSERT INTO semantic_concepts (key, label, group_name, applies_to, auto, sort_order, active, created_at, updated_at) VALUES
  ('ref.contract',   '관련 용역(계약)',        '엔티티 참조', 'contract_select',                   1, 0,  1, now()::text, now()::text),
  ('ref.company',    '관련 업체',              '엔티티 참조', 'company_select',                    1, 1,  1, now()::text, now()::text),
  ('ref.employee',   '관련 인원',              '엔티티 참조', 'user_select',                       1, 2,  1, now()::text, now()::text),
  ('ref.dept',       '관련 부서',              '엔티티 참조', 'dept_select',                       1, 3,  1, now()::text, now()::text),
  ('cost.travel',    '출장 경비',              '비용',        'currency,number',                   0, 4,  1, now()::text, now()::text),
  ('cost.supplies',  '사무용품비',             '비용',        'currency,number',                   0, 5,  1, now()::text, now()::text),
  ('cost.entertain', '업무추진비(회식·다과)',  '비용',        'currency,number',                   0, 6,  1, now()::text, now()::text),
  ('cost.outsource', '외주비',                 '비용',        'currency,number',                   0, 7,  1, now()::text, now()::text),
  ('cost.etc',       '기타 경비',              '비용',        'currency,number',                   0, 8,  1, now()::text, now()::text),
  ('amount.revenue', '수익·매출 금액',         '수익',        'currency',                          0, 9,  1, now()::text, now()::text),
  ('quantity.hours', '시간(시수)',             '수량',        'number',                            0, 10, 1, now()::text, now()::text),
  ('when.occurred',  '발생일(지출일·근무일)',  '시간',        'date',                              0, 11, 1, now()::text, now()::text),
  ('when.period',    '수행 기간',              '시간',        'period',                            0, 12, 1, now()::text, now()::text),
  ('dim.category',   '분석 분류(차원)',        '분류',        'select,radio,text',                 0, 13, 1, now()::text, now()::text)
ON CONFLICT (key) DO NOTHING;
