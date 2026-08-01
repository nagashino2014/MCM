-- 115: 양식 5종 시맨틱 태깅 + 경비 입력 채널 정책 반영(§4-4).
-- 설계: docs/semantic-analytics-wizard-blueprint.md §4-4·§8-6 (SW-P0 데이터 작업).
--   ① 출장보고서(frm-biz-trip-report): 표준 '지출 내역(출장 경비)' 표 부착(일자=when.occurred /
--      분류=dim.category / 내용 / 금액=cost.travel+합계) + trip_period 에 when.period 태깅.
--      → 출장 경비는 지출결의서가 아닌 이 표에 입력(문서 1건=출장 1건=용역 1건 귀속).
--   ② 지출결의서(frm-expense-report): 사용 내역 열 태깅(used_on/category/amount) + 분류 옵션에서
--      출장성 항목(교통비·유류비) 제거 → 비출장 지출 전용 + 채널 안내문 추가.
--   ③ 초과/휴일근무(frm-overtime-request): work_period=when.period, apply_hours=quantity.hours.
--   ④ 국내 출장 신청(frm-biz-trip-request)·⑤ 휴가신청(frm-leave-request): 기간 필드 when.period.
-- 엔티티 참조 필드(contract_select 등)는 타입에서 자동 태깅되므로 여기서 손대지 않는다.
-- 멱등: semantic 주입은 반복 적용해도 동일, 표/안내문 추가·옵션 교체는 존재/원형 검사 후에만.
-- 변경이 있을 때만 version+1 + 스냅샷(기존 문서는 제출 당시 버전으로 렌더).

-- ① 출장보고서
DO $$
DECLARE
  cur jsonb;
  nextfields jsonb;
  maxrow int;
BEGIN
  SELECT fields INTO cur FROM approval_forms WHERE form_id = 'frm-biz-trip-report';
  IF cur IS NULL THEN
    RAISE NOTICE 'frm-biz-trip-report 없음 — 스킵';
    RETURN;
  END IF;

  -- 기간 필드 태깅
  SELECT jsonb_agg(
           CASE WHEN elem->>'key' = 'trip_period'
                THEN elem || '{"semantic":{"concept":"when.period"}}'::jsonb
                ELSE elem END)
    INTO nextfields
    FROM jsonb_array_elements(cur) elem;

  -- 표준 '지출 내역(출장 경비)' 표 부착(이미 있으면 스킵)
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cur) elem WHERE elem->>'key' = 'trip_expenses') THEN
    SELECT COALESCE(MAX((elem->>'row')::int), 0) INTO maxrow FROM jsonb_array_elements(cur) elem;
    nextfields := nextfields || jsonb_build_array(jsonb_build_object(
      'key', 'trip_expenses',
      'label', '지출 내역(출장 경비)',
      'type', 'table',
      'row', maxrow + 1,
      'span', 3,
      'minRows', 2,
      'sumColumn', 'amount',
      'tableColumns', jsonb_build_array(
        jsonb_build_object('key','spent_on','label','일자','type','date',
                           'semantic', jsonb_build_object('concept','when.occurred')),
        jsonb_build_object('key','category','label','분류','type','select',
                           'options', jsonb_build_array('교통비','숙박비','식비','일비','기타'),
                           'semantic', jsonb_build_object('concept','dim.category')),
        jsonb_build_object('key','detail','label','내용','type','text'),
        jsonb_build_object('key','amount','label','금액','type','currency',
                           'semantic', jsonb_build_object('concept','cost.travel'))
      )
    ));
  END IF;

  IF nextfields IS DISTINCT FROM cur THEN
    UPDATE approval_forms SET fields = nextfields, version = version + 1, updated_at = now()::text
     WHERE form_id = 'frm-biz-trip-report';
    INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
    SELECT form_id, version, fields, NULL, now()::text FROM approval_forms WHERE form_id = 'frm-biz-trip-report'
    ON CONFLICT (form_id, version) DO UPDATE SET fields = EXCLUDED.fields, saved_at = EXCLUDED.saved_at;
    RAISE NOTICE '출장보고서: 지출 내역 표 부착 + 태깅 완료';
  ELSE
    RAISE NOTICE '출장보고서: 변경 없음';
  END IF;
END $$;

-- ② 지출 결의서(법인카드) — 열 태깅 + 분류 옵션 비출장 정비 + 채널 안내문
DO $$
DECLARE
  cur jsonb;
  nextfields jsonb;
  maxrow int;
BEGIN
  SELECT fields INTO cur FROM approval_forms WHERE form_id = 'frm-expense-report';
  IF cur IS NULL THEN
    RAISE NOTICE 'frm-expense-report 없음 — 스킵';
    RETURN;
  END IF;

  SELECT jsonb_agg(
           CASE WHEN elem->>'key' = 'expenses' AND elem->'tableColumns' IS NOT NULL THEN
             jsonb_set(elem, '{tableColumns}', (
               SELECT jsonb_agg(
                 CASE
                   WHEN col->>'key' = 'used_on'
                     THEN col || '{"semantic":{"concept":"when.occurred"}}'::jsonb
                   WHEN col->>'key' = 'amount'
                     THEN col || '{"semantic":{"concept":"cost.etc"}}'::jsonb
                   WHEN col->>'key' = 'category' THEN
                     (CASE
                        -- 시드 원형 그대로일 때만 옵션 교체(관리자가 이미 고쳤다면 존중)
                        WHEN col->'options' = '["식대","교통비","유류비","소모품비","접대비","교육비","기타"]'::jsonb
                        THEN jsonb_set(col, '{options}',
                               '["사무용품·소모품비","업무추진비(회식·다과)","식대(비출장)","접대비","교육비","기타(비출장)"]'::jsonb)
                        ELSE col
                      END) || '{"semantic":{"concept":"dim.category"}}'::jsonb
                   ELSE col
                 END)
               FROM jsonb_array_elements(elem->'tableColumns') col
             ))
           ELSE elem END)
    INTO nextfields
    FROM jsonb_array_elements(cur) elem;

  -- 채널 안내문 추가(이미 있으면 스킵)
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cur) elem WHERE elem->>'key' = 'expense_channel_notice') THEN
    SELECT COALESCE(MAX((elem->>'row')::int), 0) INTO maxrow FROM jsonb_array_elements(cur) elem;
    nextfields := nextfields || jsonb_build_array(jsonb_build_object(
      'key', 'expense_channel_notice',
      'label', '안내',
      'type', 'static',
      'row', maxrow + 1,
      'span', 3,
      'content', '※ 출장에서 발생한 모든 경비(교통비·숙박비·식비·일비 등)는 이 지출결의서가 아닌 [출장보고서]의 "지출 내역(출장 경비)" 항목에 입력합니다. 이 양식은 비출장성 지출(사무용품·소모품비, 업무추진비 등) 전용입니다.'
    ));
  END IF;

  IF nextfields IS DISTINCT FROM cur THEN
    UPDATE approval_forms SET fields = nextfields, version = version + 1, updated_at = now()::text
     WHERE form_id = 'frm-expense-report';
    INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
    SELECT form_id, version, fields, NULL, now()::text FROM approval_forms WHERE form_id = 'frm-expense-report'
    ON CONFLICT (form_id, version) DO UPDATE SET fields = EXCLUDED.fields, saved_at = EXCLUDED.saved_at;
    RAISE NOTICE '지출결의서: 열 태깅 + 옵션 정비 + 안내문 완료';
  ELSE
    RAISE NOTICE '지출결의서: 변경 없음';
  END IF;
END $$;

-- ③④⑤ 단순 필드 태깅(초과근무·출장신청·휴가신청) — 양식별 {필드 key: concept} 맵 일괄 주입
DO $$
DECLARE
  spec record;
  cur jsonb;
  nextfields jsonb;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('frm-overtime-request', '{"work_period":"when.period","apply_hours":"quantity.hours"}'::jsonb),
      ('frm-biz-trip-request', '{"trip_period":"when.period"}'::jsonb),
      ('frm-leave-request',    '{"leave_period":"when.period"}'::jsonb)
    ) AS t(form_id, tagmap)
  LOOP
    SELECT fields INTO cur FROM approval_forms WHERE form_id = spec.form_id;
    IF cur IS NULL THEN
      RAISE NOTICE '% 없음 — 스킵', spec.form_id;
      CONTINUE;
    END IF;

    SELECT jsonb_agg(
             CASE WHEN spec.tagmap ? (elem->>'key')
                  THEN elem || jsonb_build_object('semantic',
                         jsonb_build_object('concept', spec.tagmap->>(elem->>'key')))
                  ELSE elem END)
      INTO nextfields
      FROM jsonb_array_elements(cur) elem;

    IF nextfields IS DISTINCT FROM cur THEN
      UPDATE approval_forms SET fields = nextfields, version = version + 1, updated_at = now()::text
       WHERE form_id = spec.form_id;
      INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
      SELECT form_id, version, fields, NULL, now()::text FROM approval_forms WHERE form_id = spec.form_id
      ON CONFLICT (form_id, version) DO UPDATE SET fields = EXCLUDED.fields, saved_at = EXCLUDED.saved_at;
      RAISE NOTICE '%: 태깅 적용 %', spec.form_id, spec.tagmap;
    ELSE
      RAISE NOTICE '%: 변경 없음', spec.form_id;
    END IF;
  END LOOP;
END $$;
