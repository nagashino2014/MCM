-- 284: 개인카드 지출결의서 분류 옵션을 법인카드 지출결의서와 같은 계정과목 목록으로 정리(2026-10-16 사용자 요청).
--
-- 배경: 202 가 frm-expense-personal 을 만들 때 분류 옵션을 옛 목록(식대·교통비·유류비·소모품비·접대비·교육비·기타)으로
--   넣었으나, 같은 마이그에서 계정 매핑(expense_categories.form_option_map)은 법인카드 양식 라벨(복리후생비·사무용품비 …)을
--   그대로 복사했다. 그 결과
--     · 영수증 자동 분류가 채우는 라벨(복리후생비 등)이 개인카드 양식 옵션에 없고,
--     · 옛 라벨(식대·교통비·유류비·접대비·교육비)로 저장된 행은 전표에서 계정을 찾지 못해 가지급으로 빠진다.
--   매핑이 이미 법인카드 라벨 기준이므로 양식 옵션·도움말을 법인카드 양식의 분류 열과 같게 맞춘다.
--   (초과근무 식대 대조의 개인카드 식대 라벨도 앱 코드에서 '식대' → '복리후생비'로 함께 바꾼다.)
-- 개인카드 양식으로 상신된 문서는 아직 없다(2026-10-16 스테이징 0건) — 기존 문서 영향 없음.
-- 법인카드 양식의 분류 열(options·hint)을 적용 시점에 복사한다. 변경 시 version+1 + 스냅샷. 멱등.

DO $$
DECLARE
  src jsonb;
  cur jsonb;
  nextfields jsonb;
BEGIN
  SELECT col INTO src
    FROM approval_forms f,
         jsonb_array_elements(f.fields) AS fe(elem),
         jsonb_array_elements(fe.elem->'tableColumns') AS tc(col)
   WHERE f.form_id = 'frm-expense-report'
     AND fe.elem->>'key' = 'expenses' AND fe.elem->>'type' = 'table'
     AND tc.col->>'key' = 'category'
   LIMIT 1;
  IF src IS NULL OR jsonb_typeof(src->'options') <> 'array' THEN
    RAISE NOTICE 'frm-expense-report 분류 열 없음 — 스킵';
    RETURN;
  END IF;

  SELECT fields INTO cur FROM approval_forms WHERE form_id = 'frm-expense-personal';
  IF cur IS NULL THEN
    RAISE NOTICE 'frm-expense-personal 없음 — 스킵';
    RETURN;
  END IF;

  SELECT jsonb_agg(
           CASE WHEN elem->>'key' = 'expenses' AND elem->>'type' = 'table' THEN
             jsonb_set(elem, '{tableColumns}', (
               SELECT jsonb_agg(
                        CASE WHEN col->>'key' = 'category' THEN
                          CASE WHEN src ? 'hint'
                               THEN col || jsonb_build_object('options', src->'options', 'hint', src->'hint')
                               ELSE (col - 'hint') || jsonb_build_object('options', src->'options')
                          END
                        ELSE col END
                        ORDER BY cord)
                 FROM jsonb_array_elements(elem->'tableColumns') WITH ORDINALITY AS t(col, cord)))
           ELSE elem END
           ORDER BY ford)
    INTO nextfields
    FROM jsonb_array_elements(cur) WITH ORDINALITY AS f(elem, ford);

  IF nextfields IS DISTINCT FROM cur THEN
    UPDATE approval_forms SET fields = nextfields, version = version + 1, updated_at = now()::text
     WHERE form_id = 'frm-expense-personal';
    INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
    SELECT form_id, version, fields, NULL, now()::text FROM approval_forms WHERE form_id = 'frm-expense-personal'
    ON CONFLICT (form_id, version) DO UPDATE SET fields = EXCLUDED.fields, saved_at = EXCLUDED.saved_at;
    RAISE NOTICE 'frm-expense-personal: 분류 옵션을 법인카드 지출결의서와 맞춤';
  ELSE
    RAISE NOTICE 'frm-expense-personal: 변경 없음';
  END IF;
END $$;
