-- 성과급 지급 계획 양식 v2 — 지급 명세 표에 전기 지급대상액·증감률 열 추가,
-- 기존 지급대상액 레이블은 '금기 지급대상액'으로 변경 (2026-08-13 사용자 피드백).
-- 값 포맷(천단위 콤마)은 기안 생성 코드(lib/bonus/draft.ts)가 문자열로 채운다.

UPDATE approval_forms SET
  fields = '[
    {"key":"period","label":"지급 대상 반기","type":"text","required":true,"row":1,"span":1},
    {"key":"total","label":"지급 총액(원)","type":"currency","row":1,"span":1},
    {"key":"headcount","label":"지급 인원","type":"number","row":1,"span":1},
    {"key":"rows","label":"성과급 지급 명세","type":"table","row":2,"span":3,
     "tableColumns":[
       {"key":"name","label":"성명","type":"text"},
       {"key":"dept","label":"부서","type":"text"},
       {"key":"position","label":"직함","type":"text"},
       {"key":"amount","label":"금기 지급대상액(원)","type":"currency"},
       {"key":"prev_amount","label":"전기 지급대상액(원)","type":"currency"},
       {"key":"change","label":"증감률","type":"text"}
     ]},
    {"key":"note","label":"비고","type":"multitext","row":3,"span":3,"minRows":2}
  ]'::jsonb,
  version = 2,
  updated_at = now()::text
WHERE form_id = 'frm-bonus-plan' AND version = 1;

INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, 2, fields, NULL, now()::text FROM approval_forms
WHERE form_id = 'frm-bonus-plan' AND version = 2
ON CONFLICT (form_id, version) DO NOTHING;
