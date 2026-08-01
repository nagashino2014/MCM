-- 116: 지출 내역 표 열 구성 개편(사용자 확정: ①연번 ②사용일시 ③분류 ④상호 ⑤금액 ⑥지출 목적).
-- 대상: 출장보고서(frm-biz-trip-report).trip_expenses, 지출결의서(frm-expense-report).expenses.
-- 연번은 신규 열 타입 rowno(자동 행번호, 입력 없음 — 렌더러가 표시). 분류 옵션은 현행 값을 보존(carry).
-- 향후 바로빌 카드 내역 자동 기입 시 사용일시·상호·금액이 자동 채워지고, 사용자는 분류(자동 분류
-- 실패 건만)·지출 목적만 입력하는 흐름의 기반(docs/bank-reconciliation-blueprint.md §13).
-- 멱등: '연번(no)' 열이 이미 있으면 스킵. 변경 시 version+1 + 스냅샷(기존 문서는 제출 당시 버전 렌더).

DO $$
DECLARE
  spec record;
  cur jsonb;
  nextfields jsonb;
  catopts jsonb;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('frm-biz-trip-report', 'trip_expenses', 'cost.travel'),
      ('frm-expense-report',  'expenses',      'cost.etc')
    ) AS t(form_id, table_key, amount_concept)
  LOOP
    SELECT fields INTO cur FROM approval_forms WHERE form_id = spec.form_id;
    IF cur IS NULL THEN
      RAISE NOTICE '% 없음 — 스킵', spec.form_id;
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cur) elem WHERE elem->>'key' = spec.table_key) THEN
      RAISE NOTICE '%: % 표 없음 — 스킵', spec.form_id, spec.table_key;
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(cur) elem, jsonb_array_elements(elem->'tableColumns') col
                WHERE elem->>'key' = spec.table_key AND col->>'key' = 'no') THEN
      RAISE NOTICE '%: 이미 연번 열 있음 — 스킵', spec.form_id;
      CONTINUE;
    END IF;

    -- 현행 분류 옵션 보존(115 정비값·관리자 수정값 존중)
    SELECT col->'options' INTO catopts
      FROM jsonb_array_elements(cur) elem, jsonb_array_elements(elem->'tableColumns') col
     WHERE elem->>'key' = spec.table_key AND col->>'key' = 'category';

    -- 사용일시 키는 양식별 현행 키(spent_on/used_on)를 유지해 기존 문서 값과 호환
    SELECT jsonb_agg(
             CASE WHEN elem->>'key' = spec.table_key THEN
               jsonb_set(elem, '{tableColumns}', jsonb_build_array(
                 jsonb_build_object('key','no','label','연번','type','rowno'),
                 jsonb_build_object('key', CASE WHEN spec.form_id = 'frm-expense-report' THEN 'used_on' ELSE 'spent_on' END,
                                    'label','사용일시','type','date',
                                    'semantic', jsonb_build_object('concept','when.occurred')),
                 jsonb_build_object('key','category','label','분류','type','select',
                                    'options', COALESCE(catopts, '["기타"]'::jsonb),
                                    'semantic', jsonb_build_object('concept','dim.category')),
                 jsonb_build_object('key','vendor','label','상호','type','text'),
                 jsonb_build_object('key','amount','label','금액','type','currency',
                                    'semantic', jsonb_build_object('concept', spec.amount_concept)),
                 jsonb_build_object('key','detail','label','지출 목적','type','text')
               ))
             ELSE elem END)
      INTO nextfields
      FROM jsonb_array_elements(cur) elem;

    IF nextfields IS DISTINCT FROM cur THEN
      UPDATE approval_forms SET fields = nextfields, version = version + 1, updated_at = now()::text
       WHERE form_id = spec.form_id;
      INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
      SELECT form_id, version, fields, NULL, now()::text FROM approval_forms WHERE form_id = spec.form_id
      ON CONFLICT (form_id, version) DO UPDATE SET fields = EXCLUDED.fields, saved_at = EXCLUDED.saved_at;
      RAISE NOTICE '%: % 열 6종 개편 완료', spec.form_id, spec.table_key;
    ELSE
      RAISE NOTICE '%: 변경 없음', spec.form_id;
    END IF;
  END LOOP;
END $$;
