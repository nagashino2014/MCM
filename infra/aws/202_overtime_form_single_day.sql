-- 202: 초과근무 신청(frm-overtime-request) — 근무일을 1일 단위로 제한 (2026-08-27 확정)
-- 일자별 대조(lib/payroll/overtime.ts matchOvertimeRequests)가 근무일 하루를 전제하는데
-- work_period 가 기간(from~to) 입력이라 여러 날 신청 시 첫날에만 전체 시간이 배분되는
-- 오판정 위험이 있었다. 렌더러(웹 ApprovalFormRenderer·모바일 FormField)가 지원하는
-- period 의 singleDay 옵션을 켜 단일 날짜 입력으로 바꾼다(저장 구조 {from,to} 는 유지,
-- to=from 으로 저장 — 기존 조회 코드 무수정). 서버는 상신 시 from≠to 를 거부한다
-- (lib/approval/overtime.ts assessOverLimitOnSubmit).
-- 141 관례: 요소 단위 수정 + version+1 + 버전 스냅샷. 멱등 가드: singleDay 미적용일 때만.

UPDATE approval_forms f
   SET fields = (
         SELECT jsonb_agg(
                  CASE
                    WHEN e->>'key' = 'work_period'
                      THEN e || '{"label":"근무일","singleDay":true}'::jsonb
                    ELSE e
                  END
                  ORDER BY ord)
           FROM jsonb_array_elements(f.fields) WITH ORDINALITY AS t(e, ord)
       ),
       version = version + 1,
       updated_at = now()::text
 WHERE f.form_id = 'frm-overtime-request'
   AND NOT f.fields @> '[{"key":"work_period","singleDay":true}]'::jsonb;

-- 개정본 버전 스냅샷 — 개정 전 상신 문서는 제출 당시 버전(form_versions)으로 렌더된다.
INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, version, fields, NULL, now()::text
  FROM approval_forms
 WHERE form_id = 'frm-overtime-request'
   AND fields @> '[{"key":"work_period","singleDay":true}]'::jsonb
ON CONFLICT (form_id, version) DO NOTHING;

-- 기존 문서는 손대지 않는다 — 이미 승인된 기간 신청의 값 변경은 신청 내용 변조가 되고,
-- 대조 로직은 from 만 읽으므로 동작도 달라지지 않는다(다일 신청 방지는 신규 상신부터).
