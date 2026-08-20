-- 196: 지출 내역 표의 "지출 목적"(detail) 열을 필수 입력으로 (사용자 확정 2026-08-20).
-- 대상: 출장보고서(frm-biz-trip-report).trip_expenses, 지출결의서(frm-expense-report).expenses.
-- 배경: 영수증 촬영·법인카드 불러오기로 행이 자동 생성되면 목적이 빈 채로 상신되는 일이 잦다.
--       개인 영수증은 촬영 때 적어 둔 지출목적(memo)이 승계되지만, 법인카드는 채울 소스가 없어
--       사용자가 직접 적어야 한다 — 값이 있는 행에서 이 열이 비면 기안 화면·서버 모두 상신을 막는다.
-- 판정 규칙은 lib/approval/fields.ts:missingTableRequirements 참고(빈 행은 검사 대상 아님).
-- 멱등: detail 열이 이미 required 면 변경 없음(스킵). 변경 시 version+1 + 스냅샷.

DO $$
DECLARE
  spec record;
  cur jsonb;
  nextfields jsonb;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('frm-biz-trip-report', 'trip_expenses'),
      ('frm-expense-report',  'expenses')
    ) AS t(form_id, table_key)
  LOOP
    SELECT fields INTO cur FROM approval_forms WHERE form_id = spec.form_id;
    IF cur IS NULL THEN
      RAISE NOTICE '% 없음 — 스킵', spec.form_id;
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cur) elem, jsonb_array_elements(elem->'tableColumns') col
                    WHERE elem->>'key' = spec.table_key AND col->>'key' = 'detail') THEN
      RAISE NOTICE '%: % 표에 지출 목적(detail) 열 없음 — 스킵', spec.form_id, spec.table_key;
      CONTINUE;
    END IF;

    SELECT jsonb_agg(
             CASE WHEN elem->>'key' = spec.table_key THEN
               jsonb_set(elem, '{tableColumns}', (
                 SELECT jsonb_agg(
                          CASE WHEN col->>'key' = 'detail' THEN col || '{"required": true}'::jsonb ELSE col END
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
      RAISE NOTICE '%: 지출 목적 필수 지정 완료', spec.form_id;
    ELSE
      RAISE NOTICE '%: 이미 필수 — 변경 없음', spec.form_id;
    END IF;
  END LOOP;
END $$;
