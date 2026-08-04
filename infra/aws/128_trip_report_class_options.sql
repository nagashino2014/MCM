-- 128: 출장보고서 용역분류(service_class) 옵션을 출장신청서(122 개정값)와 정합.
-- 배경: 선행 문서 자동 완성(127)이 신청서 contract_class 값(라벨 '용역분류' 매칭)을 보고서에
-- 주입하는데, 옵션 텍스트가 다르면 체크박스에 표시되지 않는다. 실측(2026-08-03) 현행 보고서
-- 옵션은 관리자 수정분(ESG탄소중립 추가)이 반영된 [통합,화관법,HAPs,ESG탄소중립,기타] —
-- 전체 교체가 아니라 '통합'→'통합허가' 원소만 치환해 관리자 수정을 존중한다.
-- 기존 제출 문서는 제출 당시 버전 스냅샷으로 렌더되므로 안전.
-- 멱등: '통합' 옵션이 있고 '통합허가'가 없을 때만 치환.

DO $$
DECLARE
  cur jsonb;
  nextfields jsonb;
BEGIN
  SELECT fields INTO cur FROM approval_forms WHERE form_id = 'frm-biz-trip-report';
  IF cur IS NULL THEN
    RAISE NOTICE 'frm-biz-trip-report 없음 — 스킵';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cur) elem
                  WHERE elem->>'key' = 'service_class'
                    AND elem->'options' ? '통합'
                    AND NOT (elem->'options' ? '통합허가')) THEN
    RAISE NOTICE 'frm-biz-trip-report: 치환 대상(통합) 없음 — 스킵';
    RETURN;
  END IF;

  SELECT jsonb_agg(
           CASE WHEN elem->>'key' = 'service_class'
             THEN jsonb_set(elem, '{options}',
               (SELECT jsonb_agg(CASE WHEN opt = '"통합"'::jsonb THEN '"통합허가"'::jsonb ELSE opt END)
                  FROM jsonb_array_elements(elem->'options') opt))
             ELSE elem END)
    INTO nextfields
    FROM jsonb_array_elements(cur) elem;

  UPDATE approval_forms SET fields = nextfields, version = version + 1, updated_at = now()::text
   WHERE form_id = 'frm-biz-trip-report';
  INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
  SELECT form_id, version, fields, NULL, now()::text FROM approval_forms WHERE form_id = 'frm-biz-trip-report'
  ON CONFLICT (form_id, version) DO UPDATE SET fields = EXCLUDED.fields, saved_at = EXCLUDED.saved_at;
  RAISE NOTICE 'frm-biz-trip-report: service_class 옵션 통합→통합허가 치환 완료';
END $$;
