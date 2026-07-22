-- 085: 휴가신청 양식(frm-leave-request)의 '휴가 종류' 필드를 leave_type 타입으로 전환.
-- 사규 [별표 5. 경조금 지급 규정] 개정안 기반 카탈로그(lib/approval/fields.ts LEAVE_ENTITLEMENTS)로
-- 렌더되며, 선택 시 규정상 부여휴가 일수가 화면에 표시된다.
-- leave_type 필드는 옵션을 카탈로그에서 가져오므로 fields 에 options 를 두지 않는다.
-- 버전 2 로 올리고 스냅샷을 남긴다(기존 문서는 제출 당시 버전으로 렌더).
-- (docs/e-approval-blueprint.md. 멱등 — 이미 leave_type 이면 재실행해도 무해)

DO $$
DECLARE
  cur jsonb;
  nextfields jsonb;
  changed boolean := false;
BEGIN
  SELECT fields INTO cur FROM approval_forms WHERE form_id = 'frm-leave-request';
  IF cur IS NULL THEN
    RAISE NOTICE 'frm-leave-request 없음 — 스킵';
    RETURN;
  END IF;

  -- leave_type 필드를 새 타입으로 치환(options 제거, type=leave_type)
  SELECT jsonb_agg(
           CASE
             WHEN elem->>'key' = 'leave_type'
             THEN jsonb_build_object(
                    'key','leave_type','label','휴가 종류','type','leave_type',
                    'required', COALESCE((elem->>'required')::boolean, true),
                    'row', COALESCE((elem->>'row')::int, 1),
                    'span', COALESCE((elem->>'span')::int, 3))
             ELSE elem
           END
         )
    INTO nextfields
    FROM jsonb_array_elements(cur) elem;

  IF nextfields IS DISTINCT FROM cur THEN
    UPDATE approval_forms
       SET fields = nextfields,
           version = version + 1,
           updated_at = now()::text
     WHERE form_id = 'frm-leave-request';
    changed := true;
  END IF;

  IF changed THEN
    INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
    SELECT 'frm-leave-request', version, fields, NULL, now()::text
      FROM approval_forms WHERE form_id = 'frm-leave-request'
    ON CONFLICT (form_id, version) DO UPDATE SET fields = EXCLUDED.fields, saved_at = EXCLUDED.saved_at;
    RAISE NOTICE 'leave_type 필드 전환 완료';
  ELSE
    RAISE NOTICE '변경 없음(이미 leave_type)';
  END IF;
END $$;
