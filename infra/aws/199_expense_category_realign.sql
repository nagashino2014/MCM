-- 199: 지출 분류 ↔ 계정과목 1:1 정렬 (사용자 확정 2026-08-20).
--
-- 배경(실측): 지출결의서의 분류 옵션 6종("사무용품·소모품비","업무추진비(회식·다과)",…)이
--   expense_categories.form_option_map 의 기대값(“사무용품비”,“복리후생비”,…)과 **"접대비" 하나만
--   겹쳤다** → 카드·영수증을 불러와도 분류가 늘 빈칸이고, 상신 시 역매핑도 실패해 학습조차 되지 않았다.
--   양식 옵션명을 계정과목명과 그대로 맞춰 자동분류·학습·분개를 한 축으로 정렬한다.
--
-- 사용자 결정:
--   · 카드로 결제되지 않는 계정(경조사비·보험료·세금과공과·수도광열·전력·수선·광고선전·임차료·외주용역)은
--     계좌이체 지급이라 분류에 넣지 않는다. **회의비(827)만 신설** — 외부 방문자 회의 시 공유오피스 대관 등.
--   · 출장보고서에서 도서인쇄비는 해당 없음(제외).
--   · "일비"는 사규의 일용비(1끼 5,000원)로 식비와 합산 한도로 운용되므로 **식비로 통일(옵션 삭제)**.
--   · 접대비 → 세법·계정 명칭인 **기업업무추진비**로 개칭.
--   · 소모품비·지급수수료 등 헷갈리는 항목은 분류 열 도움말(hint)로 예시를 붙인다.
--     주차비는 출장·외근 단발이면 여비교통비, 월 정기주차면 차량유지비(계속성의 원칙 — 한쪽으로 고정).
--
-- 최종 옵션
--   · 출장보고서 8종: 여비교통비/차량유지비/숙박비/식비/기업업무추진비/소모품비/지급수수료/기타
--   · 지출결의서 12종: 여비교통비/차량유지비/복리후생비/기업업무추진비/회의비/사무용품비/소모품비/
--                      도서인쇄비/통신비/지급수수료/교육훈련비/기타
--
-- 기존 문서는 제출 당시 양식 버전(스냅샷)으로 렌더되므로 영향 없다.
-- 멱등: 옵션이 이미 아래 값이면 변경 없음. 변경 시 version+1 + 스냅샷.

-- ── 1) 회의비 신설 + 접대비 개칭 ─────────────────────────────
INSERT INTO expense_categories (category_key, label, form_option_map, biz_type_rules, store_keyword_rules, vat_deductible_default, sort_order)
VALUES ('meeting', '회의비', '{"frm-expense-report":"회의비"}',
        '["공유오피스","회의실","세미나실","대관","비즈니스센터"]',
        '["스파크플러스","패스트파이브","위워크","르호봇"]', 1, 85)
ON CONFLICT (category_key) DO NOTHING;

UPDATE expense_categories SET account_code = '827' WHERE category_key = 'meeting' AND account_code IS NULL;
UPDATE expense_categories SET label = '기업업무추진비' WHERE category_key = 'entertain' AND label = '접대비';

-- ── 2) 양식 옵션 매핑 재정비 ─────────────────────────────────
UPDATE expense_categories SET form_option_map = m.map::jsonb
  FROM (VALUES
    ('travel',      '{"frm-biz-trip-report":"여비교통비","frm-expense-report":"여비교통비"}'),
    ('fuel',        '{"frm-biz-trip-report":"차량유지비","frm-expense-report":"차량유지비"}'),
    ('lodging',     '{"frm-biz-trip-report":"숙박비"}'),
    ('meal',        '{"frm-biz-trip-report":"식비","frm-expense-report":"복리후생비"}'),
    ('entertain',   '{"frm-biz-trip-report":"기업업무추진비","frm-expense-report":"기업업무추진비"}'),
    ('meeting',     '{"frm-expense-report":"회의비"}'),
    ('supplies',    '{"frm-expense-report":"사무용품비"}'),
    ('consumables', '{"frm-biz-trip-report":"소모품비","frm-expense-report":"소모품비"}'),
    ('printing',    '{"frm-expense-report":"도서인쇄비"}'),
    ('comm',        '{"frm-expense-report":"통신비"}'),
    ('fee',         '{"frm-biz-trip-report":"지급수수료","frm-expense-report":"지급수수료"}'),
    ('education',   '{"frm-expense-report":"교육훈련비"}'),
    ('etc',         '{"frm-biz-trip-report":"기타","frm-expense-report":"기타"}')
  ) AS m(key, map)
  WHERE expense_categories.category_key = m.key
    AND expense_categories.form_option_map IS DISTINCT FROM m.map::jsonb;

-- ── 3) 양식의 분류 열 옵션·도움말 교체 ───────────────────────
DO $$
DECLARE
  spec record;
  cur jsonb;
  nextfields jsonb;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('frm-biz-trip-report', 'trip_expenses',
       '["여비교통비","차량유지비","숙박비","식비","기업업무추진비","소모품비","지급수수료","기타"]',
       '여비교통비 = 철도·택시·항공, 출장·외근 중 단발 주차비'  || chr(10) ||
       '차량유지비 = 주유·통행료·세차·정비, 월 정기 주차비'      || chr(10) ||
       '식비 = 임직원 식대(사규상 일용비 포함)'                   || chr(10) ||
       '기업업무추진비 = 거래처와 동석한 식사·선물'               || chr(10) ||
       '소모품비 = 현장 소모품·소액 비품'                         || chr(10) ||
       '지급수수료 = 등기·증명 발급, 송금 수수료'),
      ('frm-expense-report',  'expenses',
       '["여비교통비","차량유지비","복리후생비","기업업무추진비","회의비","사무용품비","소모품비","도서인쇄비","통신비","지급수수료","교육훈련비","기타"]',
       '복리후생비 = 회식·다과·직원 식대'                          || chr(10) ||
       '기업업무추진비 = 거래처 접대·선물'                         || chr(10) ||
       '회의비 = 외부 회의용 공유오피스 대관, 회의 다과'           || chr(10) ||
       '사무용품비 = 문구·사무기기·전산 소모'                      || chr(10) ||
       '소모품비 = 탕비실·청소용품 등 소액 소모품'                 || chr(10) ||
       '지급수수료 = 등기·증명 발급, 송금·결제 수수료'             || chr(10) ||
       '여비교통비 = 시내 교통·단발 주차 / 차량유지비 = 주유·정기주차')
    ) AS t(form_id, table_key, opts, hint)
  LOOP
    SELECT fields INTO cur FROM approval_forms WHERE form_id = spec.form_id;
    IF cur IS NULL THEN
      RAISE NOTICE '% 없음 — 스킵', spec.form_id;
      CONTINUE;
    END IF;

    SELECT jsonb_agg(
             CASE WHEN elem->>'key' = spec.table_key THEN
               jsonb_set(elem, '{tableColumns}', (
                 SELECT jsonb_agg(
                          CASE WHEN col->>'key' = 'category'
                               THEN col || jsonb_build_object('options', spec.opts::jsonb, 'hint', spec.hint)
                               ELSE col END
                          ORDER BY cord)
                   FROM jsonb_array_elements(elem->'tableColumns') WITH ORDINALITY AS c(col, cord)))
             ELSE elem END
             ORDER BY ford)
      INTO nextfields
      FROM jsonb_array_elements(cur) WITH ORDINALITY AS f(elem, ford);

    IF nextfields IS DISTINCT FROM cur THEN
      UPDATE approval_forms SET fields = nextfields, version = version + 1, updated_at = now()::text
       WHERE form_id = spec.form_id;
      INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
      SELECT form_id, version, fields, NULL, now()::text FROM approval_forms WHERE form_id = spec.form_id
      ON CONFLICT (form_id, version) DO UPDATE SET fields = EXCLUDED.fields, saved_at = EXCLUDED.saved_at;
      RAISE NOTICE '%: 분류 옵션·도움말 재편 완료', spec.form_id;
    ELSE
      RAISE NOTICE '%: 변경 없음', spec.form_id;
    END IF;
  END LOOP;
END $$;
