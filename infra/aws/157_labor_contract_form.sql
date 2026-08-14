-- 급여·근로계약 PL-P0: 근로계약 갱신 기안 양식 (docs/payroll-labor-contract-blueprint.md §2-3, §5-2)
-- 일괄(연간)·개별(승진) 라운드의 대표이사 직결 기안 — 152_bonus_p3.sql(frm-bonus-plan) 패턴.
-- 라운드는 결재 완료(approved) 전까지 발송 버튼이 비활성화된다(시스템 게이트, bonus 와 다른 점).

INSERT INTO approval_forms
  (form_id, folder_id, name, description, fields, doc_no_rule, retention_years, org_folder, dept_folder, mobile_allowed, sort_order, created_at, updated_at)
VALUES
  ('frm-labor-contract', 'fld-hr', '근로계약서 갱신 계획', '연간 일괄 갱신 또는 개별(승진) 근로계약서 작성 계획 — 급여·근로계약 메뉴에서 자동 기안. 대표이사 직결. 결재 완료 후 발송 가능.',
   '[
     {"key":"roundKind","label":"구분","type":"text","required":true,"row":1,"span":1},
     {"key":"baseDate","label":"작성/갱신 기준일","type":"text","required":true,"row":1,"span":1},
     {"key":"headcount","label":"대상 인원","type":"number","row":1,"span":1},
     {"key":"cpiRate","label":"전년도 물가상승률(%)","type":"text","row":2,"span":1},
     {"key":"extraRate","label":"추가 보정 비율(%)","type":"text","row":2,"span":1},
     {"key":"scope","label":"대상 범위","type":"text","row":2,"span":1},
     {"key":"rows","label":"근로계약 갱신 명세","type":"table","row":3,"span":3,
      "tableColumns":[
        {"key":"name","label":"성명","type":"text"},
        {"key":"dept","label":"부서","type":"text"},
        {"key":"position","label":"직급","type":"text"},
        {"key":"currentSalary","label":"현행 연봉(원)","type":"currency"},
        {"key":"newSalary","label":"갱신 연봉(원)","type":"currency"},
        {"key":"raisePct","label":"인상률(%)","type":"text"}
      ]},
     {"key":"note","label":"비고","type":"multitext","row":4,"span":3,"minRows":2}
   ]'::jsonb,
   '근로계약갱신', 10, '인사 문서', '인사 문서', 0, 31, now()::text, now()::text)
ON CONFLICT (form_id) DO NOTHING;

INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, 1, fields, NULL, now()::text FROM approval_forms
WHERE form_id = 'frm-labor-contract'
ON CONFLICT (form_id, version) DO NOTHING;
