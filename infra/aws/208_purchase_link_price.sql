-- 208: 구매품의서 link 열 — 판매 단가 자동 기입 대상 열 지정(FRM-P1 후속, 08-26 실증 피드백).
-- 쇼핑몰이 서버 fetch 를 차단해 수집 경로를 converter Chromium 렌더로 교체하면서 단가(fillPriceTarget)
-- 추출을 추가 — 구매품의서 품목 표의 link 열에 unit_price 를 배선한다. 멱등: 이미 지정돼 있으면 스킵.

DO $$
DECLARE
  cur jsonb;
  nextfields jsonb;
BEGIN
  SELECT fields INTO cur FROM approval_forms WHERE form_id = 'frm-purchase-request';
  IF cur IS NULL THEN
    RAISE NOTICE 'frm-purchase-request 없음 — 스킵';
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(cur) elem, jsonb_array_elements(elem->'tableColumns') col
     WHERE elem->>'key' = 'items' AND col->>'key' = 'link' AND col ? 'fillPriceTarget'
  ) THEN
    RAISE NOTICE '이미 fillPriceTarget 지정됨 — 스킵';
    RETURN;
  END IF;

  SELECT jsonb_agg(
           CASE WHEN elem->>'key' = 'items' THEN
             jsonb_set(elem, '{tableColumns}', (
               SELECT jsonb_agg(
                        CASE WHEN col->>'key' = 'link'
                             THEN col || '{"fillPriceTarget":"unit_price"}'::jsonb
                             ELSE col END)
                 FROM jsonb_array_elements(elem->'tableColumns') col
             ))
           ELSE elem END)
    INTO nextfields
    FROM jsonb_array_elements(cur) elem;

  UPDATE approval_forms SET fields = nextfields, version = version + 1, updated_at = now()::text
   WHERE form_id = 'frm-purchase-request';
  INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
  SELECT form_id, version, fields, NULL, now()::text FROM approval_forms WHERE form_id = 'frm-purchase-request'
  ON CONFLICT (form_id, version) DO UPDATE SET fields = EXCLUDED.fields, saved_at = EXCLUDED.saved_at;
  RAISE NOTICE 'frm-purchase-request link 열에 fillPriceTarget=unit_price 지정 완료';
END $$;
