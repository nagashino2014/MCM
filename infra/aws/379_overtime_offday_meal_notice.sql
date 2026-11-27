-- 379: 초과근무 신청(frm-overtime-request) 양식 하단 식대 안내 개정 — 휴일 식대 불인정 (2026-11-26 사용자 결정)
-- 배경: 휴일(토·일·공휴일) 근무는 근무 시간 전부를 초과근무수당으로 지급하므로, 식대까지 주면 중복 지출이다.
--   예전 회사 규칙("주말은 시간은 모두 인정하되 초과근무 식대는 지급하지 않는다")으로 되돌린다.
--   판정 로직은 lib/approval/overtime-meal.ts — 휴일 식대 행은 신청 시간과 무관하게 위반으로 잡고,
--   개인 결제분은 상신 시 '불지급'으로 자동 처분, 법인카드분은 경고로 남겨 관리자가 환수 여부를 정한다.
--   overtime_meal_warnings 표 구조는 그대로다(휴일 불인정은 required_minutes = 0 으로 기록).
-- 317 의 meal_notice(static) 요소 content 만 새 문구로 바꾼다. 141·202·317 관례: fields 를 통째로 바꾸지 않고
--   해당 요소만 교체 + version+1 + 버전 스냅샷.
-- 멱등 가드: meal_notice 의 content 가 새 문구와 다를 때만(재적용 시 UPDATE 0행 + 스냅샷 conflict no-op).
-- ADT·intel 배치가 쓰는 표(adt_*, attendance_*, intel_*)는 건드리지 않는다.

WITH new_text AS (
  SELECT '※ 초과근무 시간은 저녁 식사 시간을 빼지 않고 신청한 근무 시간 전부를 인정합니다. 휴일(토·일·공휴일) 근무도 근무 시간 전부를 인정합니다.' || chr(10) ||
         '※ 초과근무 식대(지출결의서 복리후생비)는 평일에 그 날 초과근무 신청이 2시간 이상일 때만 사용할 수 있습니다(17:00 이후 결제분). 휴일 근무에는 초과근무 식대를 지급하지 않습니다. 지출결의서를 올리면 초과근무 신청과 자동 대조되어, 기준에 맞지 않으면 결재자에게 경고가 표시되고 개인 결제한 휴일 식대는 환급되지 않습니다.' AS content
)
UPDATE approval_forms f
   SET fields = (
         SELECT jsonb_agg(
                  CASE WHEN e->>'key' = 'meal_notice'
                       THEN jsonb_set(e, '{content}', to_jsonb(n.content))
                       ELSE e END
                  ORDER BY ord)
           FROM jsonb_array_elements(f.fields) WITH ORDINALITY AS t(e, ord)
       ),
       version = version + 1,
       updated_at = now()::text
  FROM new_text n
 WHERE f.form_id = 'frm-overtime-request'
   AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(f.fields) e
          WHERE e->>'key' = 'meal_notice'
            AND e->>'content' IS DISTINCT FROM n.content
       );

-- 개정본 버전 스냅샷 — 개정 전 상신 문서는 제출 당시 버전(form_versions)으로 렌더된다.
INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, version, fields, NULL, now()::text
  FROM approval_forms
 WHERE form_id = 'frm-overtime-request'
   AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(fields) e
          WHERE e->>'key' = 'meal_notice' AND e->>'content' LIKE '%휴일 근무에는 초과근무 식대를 지급하지 않습니다%'
       )
ON CONFLICT (form_id, version) DO NOTHING;
