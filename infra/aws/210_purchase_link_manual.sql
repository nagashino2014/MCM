-- 210: 구매품의서 링크 자동 수집 폐기(08-26 사용자 확정) — 기안자가 품명·단가를 직접 입력한다.
-- 실측: 쿠팡(403)·네이버쇼핑(로그인 강제)·G마켓(챌린지 — 오히려 "잠시만 기다리십시오…"가 품명에
-- 오기입)은 Chromium 렌더까지 차단하는 상용 봇 방어라 자동화 불가. 링크 열은 결재자 참고용으로 유지.
--  ① link 열의 fillTarget/fillPriceTarget 제거  ② 안내문을 직접 입력 안내로 교체. 멱등.

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
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(cur) elem, jsonb_array_elements(elem->'tableColumns') col
     WHERE elem->>'key' = 'items' AND col->>'key' = 'link' AND (col ? 'fillTarget' OR col ? 'fillPriceTarget')
  ) THEN
    RAISE NOTICE '이미 정리됨 — 스킵';
    RETURN;
  END IF;

  SELECT jsonb_agg(
           CASE
             WHEN elem->>'key' = 'items' THEN
               jsonb_set(elem, '{tableColumns}', (
                 SELECT jsonb_agg(
                          CASE WHEN col->>'key' = 'link'
                               THEN (col - 'fillTarget') - 'fillPriceTarget'
                               ELSE col END)
                   FROM jsonb_array_elements(elem->'tableColumns') col
               ))
             WHEN elem->>'key' = 'notice' THEN
               jsonb_set(elem, '{content}',
                 to_jsonb('상품 링크는 결재자 참고용입니다 — 품명·수량·단가는 직접 입력해 주세요(주요 쇼핑몰의 차단으로 자동 수집은 지원하지 않습니다).'
                          || E'\n구입 완료 후 지출결의서(법인카드) 기안 시 이 문서를 선행 문서로 선택하면 내역이 자동 연계됩니다.'))
             ELSE elem
           END)
    INTO nextfields
    FROM jsonb_array_elements(cur) elem;

  UPDATE approval_forms SET fields = nextfields, version = version + 1, updated_at = now()::text
   WHERE form_id = 'frm-purchase-request';
  INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
  SELECT form_id, version, fields, NULL, now()::text FROM approval_forms WHERE form_id = 'frm-purchase-request'
  ON CONFLICT (form_id, version) DO UPDATE SET fields = EXCLUDED.fields, saved_at = EXCLUDED.saved_at;
  RAISE NOTICE '구매품의서 링크 자동 수집 배선 제거 + 안내문 교체 완료';
END $$;
