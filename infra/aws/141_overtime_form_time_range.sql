-- 141: 초과근무 신청(frm-overtime-request) 양식 개선
--   ① work_time: text 자유 입력("예: 18:30 ~ 21:30") → time_range(시작/종료를 HHMM 으로 각각 입력)
--      사람마다 형식이 달라 시간 인식이 불가능했다. 값은 {"start":"HH:MM","end":"HH:MM"} 구조로 저장된다.
--   ② 담당 프로젝트(contract_select)에 fillMap 추가 — 계약 선택 시 업체명(company_name)·
--      용역분류(service_class)가 자동 채워지고, 렌더러가 해당 필드를 잠근다(별도 입력 불필요).
--   ③ service_class 옵션 '통합환경허가' → '통합허가' — contracts.service_type 의 실제 값
--      (HAPs·통합허가·장외&화관법·ESG탄소중립·기타)과 일치해야 ②의 자동 채움이 매칭된다.
-- 빌더로 편집된 양식(v8)이므로 fields 를 통째로 교체하지 않고 요소 단위로 수정한다.
-- 멱등 가드: work_time 이 아직 text 일 때만 적용(재적용 시 UPDATE 0행).

UPDATE approval_forms f
   SET fields = (
         SELECT jsonb_agg(
                  CASE
                    WHEN e->>'key' = 'work_time'
                      THEN (e - 'placeholder') || '{"type":"time_range"}'::jsonb
                    WHEN e->>'type' = 'contract_select'
                      THEN e || '{"fillMap":[{"source":"counterpartyName","target":"company_name"},
                                             {"source":"serviceType","target":"service_class"}]}'::jsonb
                    WHEN e->>'key' = 'service_class'
                      THEN jsonb_set(e, '{options}', '["통합허가","장외&화관법","HAPs","ESG탄소중립","기타"]'::jsonb)
                    ELSE e
                  END
                  ORDER BY ord)
           FROM jsonb_array_elements(f.fields) WITH ORDINALITY AS t(e, ord)
       ),
       version = version + 1,
       updated_at = now()::text
 WHERE f.form_id = 'frm-overtime-request'
   AND f.fields @> '[{"key":"work_time","type":"text"}]'::jsonb;

-- 개정본 버전 스냅샷 — 개정 전 상신 문서는 제출 당시 버전(form_versions)으로 렌더된다.
INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, version, fields, NULL, now()::text
  FROM approval_forms
 WHERE form_id = 'frm-overtime-request'
   AND fields @> '[{"key":"work_time","type":"time_range"}]'::jsonb
ON CONFLICT (form_id, version) DO NOTHING;

-- 기존 문서의 자유 텍스트 시간("18:30 ~ 21:30", "1830~2130", "9:30 - 12:00")을 {start,end} 로 변환.
-- (2026-08-07 기준 이 양식의 문서는 0건이라 실질 no-op — 재적용·백필 대비 멱등 처리)
WITH parsed AS (
  SELECT d.doc_id,
         (regexp_match(d.field_values->>'work_time',
                       '(\d{1,2})\s*[:시]?\s*(\d{2})\s*[~\-–—]\s*(\d{1,2})\s*[:시]?\s*(\d{2})'))[1:4] AS m
    FROM approval_docs d
   WHERE d.form_id = 'frm-overtime-request'
     AND jsonb_typeof(d.field_values->'work_time') = 'string'
     AND COALESCE(d.field_values->>'work_time', '') <> ''
)
UPDATE approval_docs d
   SET field_values = jsonb_set(
         d.field_values, '{work_time}',
         jsonb_build_object(
           'start', lpad(p.m[1], 2, '0') || ':' || p.m[2],
           'end',   lpad(p.m[3], 2, '0') || ':' || p.m[4]
         ))
  FROM parsed p
 WHERE d.doc_id = p.doc_id
   AND p.m IS NOT NULL;

-- ③ 과 짝을 이루는 기존 문서 값 정정(옵션에서 사라진 값이 문서에 남아 빈칸으로 보이는 것 방지)
UPDATE approval_docs
   SET field_values = jsonb_set(field_values, '{service_class}', '"통합허가"'::jsonb)
 WHERE form_id = 'frm-overtime-request'
   AND field_values->>'service_class' = '통합환경허가';
