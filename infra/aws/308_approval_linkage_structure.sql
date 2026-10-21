-- 308: 결재 양식↔마스터 연계 L1 — 입력 구조 교정(2026-10-21).
-- 설계: docs/approval-master-linkage-audit-2026-10-21.md §4 L1(결정 D-1: 원가 귀속 항목은 '선택'으로 시작).
--
-- 1) 인사 이력(employee_hr_events)에 doc_id — 퇴직원·휴직원·인사 발령 승인 기록이 문서 번호를 note 문자열에만
--    남겨 LIKE 로 중복을 판정하던 것을 컬럼으로 바꾼다. 기존 기록은 note 의 '(양식명 문서번호)' 꼬리로 백필.
-- 2) 인사 발령 표 — 발령 직급(new_position)·발령 부서(to_dept) 열을 자유 텍스트 → 직급(position)·부서(dept) 선택 열.
--    값은 {positionId,name}/{deptId,name}. 기존 문서의 문자열 값은 화면에서 '(목록 외)'로 그대로 보인다.
--    안내문의 "직급명/부서명과 동일하게 입력하면 자동 연결" 문구도 "목록에서 고르면 반영"으로 바꾼다.
-- 3) 인사·급여 자동 생성 표(성과급 지급 계획·상여금 지급 계획·근로계약서 갱신 계획)의 명세 표에 rowRef='employee'
--    — 행마다 _employeeId(기안 생성 코드가 넣음)로 직원에 귀속(관계 맵·지표·상여대장 매칭).
-- 4) 원가 귀속 '관련 용역(계약)' 선택 항목(contract_select, 필수 아님) — 구매품의서·업무기안·전문가활용비 지급 신청서·
--    교육훈련 신청. 안내문(notice) 바로 앞 행에 넣고 그 뒤 행은 한 줄씩 민다(같은 행에 겹치지 않게).
--
-- 양식은 관리자가 빌더로 고쳤을 수 있어 key 로 찾아 바꾼다(없는 양식·필드는 건너뜀).
-- 변경된 양식만 version+1 + 스냅샷(기존 상신 문서는 당시 버전으로 렌더). 멱등.

ALTER TABLE employee_hr_events ADD COLUMN IF NOT EXISTS doc_id text;
CREATE INDEX IF NOT EXISTS idx_employee_hr_events_doc ON employee_hr_events (doc_id) WHERE doc_id IS NOT NULL;

-- 기존 기록 백필 — note 꼬리 '(퇴직원 문서번호)' 등. 문서 번호가 겹치지 않는 승인 문서만 대상.
UPDATE employee_hr_events ev
   SET doc_id = d.doc_id
  FROM approval_docs d
 WHERE ev.doc_id IS NULL
   AND d.form_id IN ('frm-resignation', 'frm-leave-absence', 'frm-hr-appointment')
   AND d.doc_no IS NOT NULL AND d.doc_no <> ''
   AND ev.note LIKE '%' || d.doc_no || ')%';

DO $$
DECLARE
  cur jsonb;
  nextfields jsonb;
  target_row int;
  spec record;
BEGIN
  -- 2) 인사 발령 표 열 타입
  SELECT fields INTO cur FROM approval_forms WHERE form_id = 'frm-hr-appointment';
  IF cur IS NOT NULL AND jsonb_typeof(cur) = 'array' THEN
    SELECT jsonb_agg(
             CASE WHEN elem->>'key' = 'appointments' AND jsonb_typeof(elem->'tableColumns') = 'array' THEN
               jsonb_set(elem, '{tableColumns}', (
                 SELECT jsonb_agg(
                          CASE WHEN col->>'key' = 'to_dept' AND col->>'type' = 'text' THEN col || '{"type":"dept"}'::jsonb
                               WHEN col->>'key' = 'new_position' AND col->>'type' = 'text' THEN col || '{"type":"position"}'::jsonb
                               ELSE col END
                          ORDER BY cord)
                   FROM jsonb_array_elements(elem->'tableColumns') WITH ORDINALITY AS t(col, cord)))
             -- 안내문 — '이름을 똑같이 입력하면 연결' 문구를 선택 열에 맞게 바꾼다(빌더로 고친 문구는 건드리지 않음)
             WHEN elem->>'key' = 'notice' AND elem->>'type' = 'static'
                  AND elem->>'content' LIKE '%등록된 직급명/부서명과 동일하게 입력하면 자동 연결됩니다.%' THEN
               jsonb_set(elem, '{content}', to_jsonb(replace(elem->>'content',
                 '발령 직급·부서는 등록된 직급명/부서명과 동일하게 입력하면 자동 연결됩니다.',
                 '발령 직급·부서는 목록에서 고르면 승인 시 그대로 반영됩니다.')))
             ELSE elem END
             ORDER BY ford)
      INTO nextfields
      FROM jsonb_array_elements(cur) WITH ORDINALITY AS e(elem, ford);
    IF nextfields IS DISTINCT FROM cur THEN
      UPDATE approval_forms SET fields = nextfields, version = version + 1, updated_at = now()::text WHERE form_id = 'frm-hr-appointment';
      INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
      SELECT form_id, version, fields, NULL, now()::text FROM approval_forms WHERE form_id = 'frm-hr-appointment'
      ON CONFLICT (form_id, version) DO UPDATE SET fields = EXCLUDED.fields, saved_at = EXCLUDED.saved_at;
      RAISE NOTICE 'frm-hr-appointment: 발령 부서·직급 선택 열';
    END IF;
  END IF;

  -- 3) 자동 생성 명세 표 rowRef
  FOR spec IN SELECT * FROM (VALUES ('frm-bonus-plan'), ('frm-bonus-payment-plan'), ('frm-labor-contract')) AS t(form_id) LOOP
    SELECT fields INTO cur FROM approval_forms WHERE form_id = spec.form_id;
    IF cur IS NULL OR jsonb_typeof(cur) <> 'array' THEN
      RAISE NOTICE '% 없음 — 스킵', spec.form_id;
      CONTINUE;
    END IF;
    SELECT jsonb_agg(
             CASE WHEN elem->>'key' = 'rows' AND elem->>'type' = 'table' AND COALESCE(elem->>'rowRef', '') = ''
                  THEN elem || '{"rowRef":"employee"}'::jsonb
                  ELSE elem END
             ORDER BY ford)
      INTO nextfields
      FROM jsonb_array_elements(cur) WITH ORDINALITY AS e(elem, ford);
    IF nextfields IS DISTINCT FROM cur THEN
      UPDATE approval_forms SET fields = nextfields, version = version + 1, updated_at = now()::text WHERE form_id = spec.form_id;
      INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
      SELECT form_id, version, fields, NULL, now()::text FROM approval_forms WHERE form_id = spec.form_id
      ON CONFLICT (form_id, version) DO UPDATE SET fields = EXCLUDED.fields, saved_at = EXCLUDED.saved_at;
      RAISE NOTICE '%: 명세 표 행 직원 귀속(rowRef)', spec.form_id;
    END IF;
  END LOOP;

  -- 4) 원가 귀속 '관련 용역(계약)' 선택 항목
  FOR spec IN SELECT * FROM (VALUES
      ('frm-purchase-request',   '구입 비용을 어느 용역에 쓰는지(공통 비품이면 비워 둡니다).'),
      ('frm-work-proposal',      '소요예산이 특정 용역에 들어가면 고릅니다.'),
      ('frm-expert-fee',         '자문료·활용비를 어느 용역의 비용으로 볼지 고릅니다.'),
      ('frm-education-request',  '용역 수행에 필요한 교육이면 고릅니다.')
    ) AS t(form_id, hint) LOOP
    SELECT fields INTO cur FROM approval_forms WHERE form_id = spec.form_id;
    IF cur IS NULL OR jsonb_typeof(cur) <> 'array' THEN
      RAISE NOTICE '% 없음 — 스킵', spec.form_id;
      CONTINUE;
    END IF;
    -- 이미 계약 검색 항목이 있으면(빌더로 추가 등) 건너뛴다
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(cur) e WHERE e->>'type' = 'contract_select') THEN
      RAISE NOTICE '%: 계약 검색 항목 있음 — 스킵', spec.form_id;
      CONTINUE;
    END IF;
    SELECT COALESCE(
             (SELECT (e->>'row')::int FROM jsonb_array_elements(cur) e WHERE e->>'key' = 'notice' AND e->>'type' = 'static' LIMIT 1),
             (SELECT COALESCE(max((e->>'row')::int), 0) + 1 FROM jsonb_array_elements(cur) e))
      INTO target_row;
    SELECT jsonb_agg(x ORDER BY ord, sub)
      INTO nextfields
      FROM (
        -- 기존 항목 — 넣을 행 이후는 한 줄씩 민다
        SELECT CASE WHEN COALESCE((elem->>'row')::int, 0) >= target_row
                    THEN elem || jsonb_build_object('row', (elem->>'row')::int + 1)
                    ELSE elem END AS x,
               CASE WHEN elem->>'key' = 'notice' AND elem->>'type' = 'static' THEN ford * 10 + 5 ELSE ford * 10 END AS ord,
               0 AS sub
          FROM jsonb_array_elements(cur) WITH ORDINALITY AS e(elem, ford)
        UNION ALL
        -- 관련 용역 — 안내문 앞(안내문이 없으면 맨 끝)
        SELECT jsonb_build_object(
                 'key', 'related_contract',
                 'label', '관련 용역(계약)',
                 'type', 'contract_select',
                 'required', false,
                 'row', target_row,
                 'placeholder', spec.hint),
               COALESCE((SELECT ford * 10 + 4 FROM jsonb_array_elements(cur) WITH ORDINALITY AS e2(elem, ford)
                          WHERE elem->>'key' = 'notice' AND elem->>'type' = 'static' LIMIT 1), 1000000),
               1
      ) s;
    IF nextfields IS DISTINCT FROM cur THEN
      UPDATE approval_forms SET fields = nextfields, version = version + 1, updated_at = now()::text WHERE form_id = spec.form_id;
      INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
      SELECT form_id, version, fields, NULL, now()::text FROM approval_forms WHERE form_id = spec.form_id
      ON CONFLICT (form_id, version) DO UPDATE SET fields = EXCLUDED.fields, saved_at = EXCLUDED.saved_at;
      RAISE NOTICE '%: 관련 용역(계약) 항목 추가(행 %)', spec.form_id, target_row;
    END IF;
  END LOOP;
END $$;
