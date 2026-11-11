-- 350: 출장보고서 '지출 내역(출장 경비)' 필수 해제 (사용자 요청 2026-11-11).
-- 배경: 법인 차량으로 가는 근거리 출장처럼 경비가 없는 출장이 있는데, 지출 내역이 비면 상신이 막혔다.
--       표 자체의 필수는 마이그레이션이 아니라 운영 중 양식 관리(빌더)·사전검토 정책 화면에서 켜진 설정이라
--       두 군데를 모두 본다.
--   ① approval_forms(frm-biz-trip-report).fields 의 trip_expenses 필드 required → false
--      (기안 화면의 "필수 항목을 입력하세요" 검사 대상에서 빠진다)
--   ② approval_form_policies 의 trip_expenses 대상 required_field 정책 → 비활성(active=0)
--      (상신 사전검토의 필수 규칙. 행은 지우지 않는다 — 필요하면 사전검토 정책 화면에서 다시 켠다)
-- 그대로 두는 것: 지출 행이 있을 때의 규칙(지출 목적·연관 용역 필수 196·283, 불러오기 전용 G-8).
-- ⚠ fields 를 통째로 교체하지 않는다 — trip_expenses 요소의 required 키만 바꾼다.
-- 멱등: 이미 필수가 아니면 변경 없음(스킵). 변경 시 version+1 + 스냅샷(196 과 같은 방식).

DO $$
DECLARE
  cur jsonb;
  nextfields jsonb;
  off_count integer;
BEGIN
  SELECT fields INTO cur FROM approval_forms WHERE form_id = 'frm-biz-trip-report';
  IF cur IS NULL THEN
    RAISE NOTICE 'frm-biz-trip-report 없음 — 스킵';
  ELSE
    SELECT jsonb_agg(
             CASE WHEN elem->>'key' = 'trip_expenses' AND elem->'required' = 'true'::jsonb
                  THEN elem || '{"required": false}'::jsonb
                  ELSE elem END
             ORDER BY ford)
      INTO nextfields
      FROM jsonb_array_elements(cur) WITH ORDINALITY AS f(elem, ford);

    IF nextfields IS DISTINCT FROM cur THEN
      UPDATE approval_forms SET fields = nextfields, version = version + 1, updated_at = now()::text
       WHERE form_id = 'frm-biz-trip-report';
      INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
      SELECT form_id, version, fields, NULL, now()::text FROM approval_forms WHERE form_id = 'frm-biz-trip-report'
      ON CONFLICT (form_id, version) DO UPDATE SET fields = EXCLUDED.fields, saved_at = EXCLUDED.saved_at;
      RAISE NOTICE '출장보고서: 지출 내역 필수 해제 완료';
    ELSE
      RAISE NOTICE '출장보고서: 지출 내역은 이미 필수가 아님 — 양식 변경 없음';
    END IF;
  END IF;

  UPDATE approval_form_policies
     SET active = 0, updated_at = now()::text
   WHERE form_id = 'frm-biz-trip-report'
     AND field_key = 'trip_expenses'
     AND kind = 'required_field'
     AND active = 1;
  GET DIAGNOSTICS off_count = ROW_COUNT;
  RAISE NOTICE '출장보고서: 지출 내역 필수 사전검토 정책 % 건 비활성', off_count;
END $$;
