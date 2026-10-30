-- 317: 초과근무 신청(frm-overtime-request) 양식 하단에 시간 인정·식대 기준 안내(static) 추가 (2026-10-30 사용자 요청)
-- 사내 테스트 피드백("업무시간 08:00~17:00이면 17:00~18:00 저녁시간 제외, 18:00부터 야근 인정")에 대한 확정 기준:
--   저녁 식사 시간을 빼는 것은 판례상 허용되지 않아 신청한 근무 시간은 전부 인정하고, 대신 초과근무 식대는
--   그 날 초과근무 신청이 평일 2시간 이상(휴일 4시간 이상)일 때만 인정한다(사규 2026-08-27, 마이그 203·
--   lib/approval/overtime-meal.ts 대조 로직). 기안자가 혼동하지 않도록 양식 맨 아래에 기준을 적어 둔다.
-- 141·202 관례: 빌더로 편집된 양식이라 fields 를 통째로 바꾸지 않고 요소를 덧붙인다 + version+1 + 버전 스냅샷.
-- 멱등 가드: meal_notice 가 아직 없을 때만(재적용 시 UPDATE 0행 + 스냅샷 conflict no-op).

UPDATE approval_forms f
   SET fields = f.fields || jsonb_build_array(
         jsonb_build_object(
           'key', 'meal_notice',
           'label', '안내',
           'type', 'static',
           'content', '※ 초과근무 시간은 저녁 식사 시간을 빼지 않고 신청한 근무 시간 전부를 인정합니다.' || chr(10) ||
                      '※ 초과근무 식대(지출결의서 복리후생비)는 그 날 초과근무 신청이 평일 2시간 이상(평일은 17:00 이후 결제분), 휴일(토·일·공휴일) 4시간 이상일 때만 사용할 수 있습니다. 지출결의서를 올리면 초과근무 신청과 자동 대조되어, 기준에 못 미치면 결재자에게 경고가 표시됩니다.',
           'row', COALESCE((SELECT MAX((e->>'row')::int) FROM jsonb_array_elements(f.fields) e WHERE (e->>'row') ~ '^\d+$'), 0) + 1,
           'span', 3
         )
       ),
       version = version + 1,
       updated_at = now()::text
 WHERE f.form_id = 'frm-overtime-request'
   AND NOT f.fields @> '[{"key":"meal_notice"}]'::jsonb;

-- 개정본 버전 스냅샷 — 개정 전 상신 문서는 제출 당시 버전(form_versions)으로 렌더된다.
INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, version, fields, NULL, now()::text
  FROM approval_forms
 WHERE form_id = 'frm-overtime-request'
   AND fields @> '[{"key":"meal_notice"}]'::jsonb
ON CONFLICT (form_id, version) DO NOTHING;
