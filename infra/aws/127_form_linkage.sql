-- 127: 선행-후행 문서 연관 + 양식 요소 개선(사용자 확정 요구).
--  ① approval_forms.ref_form_id — 양식별 '선행 양식' 지정(빌더에서 편집, 하드코딩 아님).
--     지정된 양식의 기안 화면에는 '선행 문서 선택' 버튼·미연결 안내·불일치 경고가 표시된다.
--  ② approval_docs.ref_doc_id — 문서 간 연관(보고서 → 신청서) 저장 + 조회 인덱스.
--  ③ 교육훈련 보고 양식(frm-education-report) 신설 — 교육훈련 신청의 후행 문서.
--  ④ 출장보고서 개정 — 접견인(receiver) text → contact_select(사업장 담당자 검색),
--     일정(schedules) 표의 시각 열 text → time(HHMM 자동완성), 동행자 열 text → people(조직도 복수 선택).
--     ⚠ fields 는 통째 교체하지 않고 jsonb 부분 수정(116 패턴) — 관리자 수정분 보존.
-- 멱등: 컬럼 IF NOT EXISTS, 시드 ON CONFLICT DO NOTHING, fields 수정은 현행 타입 가드로 스킵.

-- ① 양식: 선행 양식 지정 컬럼
ALTER TABLE approval_forms ADD COLUMN IF NOT EXISTS ref_form_id text;

-- ② 문서: 선행 문서 연결 컬럼 + 역방향 조회(이 신청서를 참조하는 보고서) 인덱스
ALTER TABLE approval_docs ADD COLUMN IF NOT EXISTS ref_doc_id text;
CREATE INDEX IF NOT EXISTS idx_approval_docs_ref_doc ON approval_docs (ref_doc_id) WHERE ref_doc_id IS NOT NULL;

-- ③ 교육훈련 보고 양식 신설 — 필드 키는 신청서(123)와 맞춘다(edu_name·edu_period —
--    선행 문서 불일치 비교가 같은 key 기간을 우선 대조하고, 캘린더 연동 재사용 여지).
INSERT INTO approval_forms
  (form_id, folder_id, name, description, fields, doc_no_rule, retention_years, org_folder, dept_folder, sort_order, ref_form_id, created_at, updated_at)
VALUES
  ('frm-education-report', 'fld-hr', '교육훈련 보고', '교육·세미나 수강 결과 보고 — 교육훈련 신청의 후행 문서(선행 문서 연결)',
   '[
     {"key":"edu_name","label":"교육명","type":"text","required":true,"row":1,"span":2},
     {"key":"edu_org","label":"교육기관","type":"text","row":1,"span":1},
     {"key":"edu_period","label":"교육기간","type":"period","required":true,"row":2,"span":2},
     {"key":"edu_place","label":"교육장소","type":"text","row":2,"span":1},
     {"key":"edu_content","label":"교육내용 요약","type":"multitext","required":true,"row":3,"span":3},
     {"key":"edu_result","label":"습득 내용·업무 적용 계획","type":"multitext","required":true,"row":4,"span":3}
   ]'::jsonb,
   '교육보고', 3, '교육 문서', '교육 문서', 4, 'frm-education-request', now()::text, now()::text)
ON CONFLICT (form_id) DO NOTHING;

INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, 1, fields, NULL, now()::text FROM approval_forms
WHERE form_id = 'frm-education-report'
ON CONFLICT (form_id, version) DO NOTHING;

-- 기존 양식 선행 지정 시드(비어 있을 때만 — 관리자가 빌더에서 바꾼 값은 존중)
UPDATE approval_forms SET ref_form_id = 'frm-biz-trip-request'
 WHERE form_id = 'frm-biz-trip-report' AND ref_form_id IS NULL;
UPDATE approval_forms SET ref_form_id = 'frm-education-request'
 WHERE form_id = 'frm-education-report' AND ref_form_id IS NULL;

-- ④ 출장보고서 요소 개선 — jsonb 부분 수정(통째 교체 금지, 116 패턴)
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
  -- 멱등 가드: 접견인이 이미 contact_select 면 적용 완료로 본다
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(cur) elem
              WHERE elem->>'key' = 'receiver' AND elem->>'type' = 'contact_select') THEN
    RAISE NOTICE 'frm-biz-trip-report: 이미 적용됨 — 스킵';
    RETURN;
  END IF;

  SELECT jsonb_agg(
           CASE
             -- 접견인: 담당자 검색(복수 태그)으로 전환. 기존 문자열 값은 렌더러가 호환 표시.
             WHEN elem->>'key' = 'receiver' AND elem->>'type' = 'text'
               THEN jsonb_set(elem, '{type}', '"contact_select"')
             -- 일정 표: 시각 열 → time(HHMM 자동완성), 동행자 열 → people(조직도 복수 선택 태그)
             WHEN elem->>'key' = 'schedules' AND elem->>'type' = 'table'
               THEN jsonb_set(elem, '{tableColumns}',
                 (SELECT jsonb_agg(
                    CASE
                      WHEN col->>'key' = 'time' AND col->>'type' = 'text' THEN jsonb_set(col, '{type}', '"time"')
                      WHEN col->>'key' = 'companions' AND col->>'type' = 'text' THEN jsonb_set(col, '{type}', '"people"')
                      ELSE col
                    END)
                    FROM jsonb_array_elements(elem->'tableColumns') col))
             ELSE elem
           END)
    INTO nextfields
    FROM jsonb_array_elements(cur) elem;

  IF nextfields IS DISTINCT FROM cur THEN
    UPDATE approval_forms SET fields = nextfields, version = version + 1, updated_at = now()::text
     WHERE form_id = 'frm-biz-trip-report';
    INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
    SELECT form_id, version, fields, NULL, now()::text FROM approval_forms WHERE form_id = 'frm-biz-trip-report'
    ON CONFLICT (form_id, version) DO UPDATE SET fields = EXCLUDED.fields, saved_at = EXCLUDED.saved_at;
    RAISE NOTICE 'frm-biz-trip-report: 접견인 contact_select·일정 time/people 열 전환 완료';
  ELSE
    RAISE NOTICE 'frm-biz-trip-report: 변경 없음';
  END IF;
END $$;
