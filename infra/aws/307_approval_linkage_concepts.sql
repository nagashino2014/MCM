-- 307: 결재 양식↔마스터 연계 L0 — 데이터 의미 개념 보강 + 양식 태그 보정(2026-10-21).
-- 설계: docs/approval-master-linkage-audit-2026-10-21.md §4 L0·L1-6.
--
-- 1) semantic_concepts 추가(114 와 같은 규약, ON CONFLICT DO NOTHING — 관리자 수정값을 덮지 않음)
--    · 이미 ID 를 저장하는 참조 타입 3종의 자동 개념: ref.asset(asset_select)·ref.contact(contact_select)·ref.leave_type(leave_type)
--    · 분석 태그: quantity.days(일수)·quantity.count(수량·인원·매수)·cost.personnel(인건비)·amount.budget(예산)·
--      amount.unit_price(단가·일급)·when.due(희망·마감일)·info.reference(참고 값 — 집계 제외)
--    lib/approval/semantic-concepts.ts DEFAULT_SEMANTIC_CONCEPTS 와 일치.
-- 2) 양식 태그 보정 — 관리자가 빌더로 고쳤을 수 있어 필드를 key 로 찾아 semantic.concept 만 붙인다.
--    · 이미 다른 의미가 붙어 있으면 건드리지 않는다(from_concept 를 지정한 오태깅 교정만 예외).
--    · 휴가신청서 사용일수(use_days)는 일수인데 quantity.hours(시간)로 태깅돼 있었다 → quantity.days.
--    · 초과근무 신청의 기사용시간·잔여시간은 근태 집계에서 자동으로 채우는 참고 수치인데 신청시간과 같은
--      quantity.hours 로 태깅돼 '시간 합계' 지표가 세 값을 더했다 → info.reference(집계 제외).
--    · 없는 양식·필드는 건너뛴다. 변경된 양식만 version+1 + 스냅샷(기존 상신 문서는 당시 버전으로 렌더). 멱등.

INSERT INTO semantic_concepts (key, label, group_name, applies_to, auto, sort_order, active, created_at, updated_at) VALUES
  ('ref.asset',         '관련 자산(차량)',          '엔티티 참조', 'asset_select',   1, 14, 1, now()::text, now()::text),
  ('ref.contact',       '관련 업체 담당자',         '엔티티 참조', 'contact_select', 1, 15, 1, now()::text, now()::text),
  ('ref.leave_type',    '휴가 종류',                '엔티티 참조', 'leave_type',     1, 16, 1, now()::text, now()::text),
  ('cost.personnel',    '인건비(급여·상여·수당)',   '비용',        'currency,number', 0, 17, 1, now()::text, now()::text),
  ('amount.budget',     '예산·계획 금액',           '수익',        'currency',       0, 18, 1, now()::text, now()::text),
  ('amount.unit_price', '단가·일급',                '수익',        'currency',       0, 19, 1, now()::text, now()::text),
  ('quantity.days',     '일수',                     '수량',        'number',         0, 20, 1, now()::text, now()::text),
  ('quantity.count',    '수량·인원·매수',           '수량',        'number',         0, 21, 1, now()::text, now()::text),
  ('when.due',          '희망·마감일',              '시간',        'date',           0, 22, 1, now()::text, now()::text),
  ('info.reference',    '참고 값(집계 제외)',       '참고',        'number,currency,date', 0, 23, 1, now()::text, now()::text)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE
  f record;
  cur jsonb;
  nextfields jsonb;
BEGIN
  DROP TABLE IF EXISTS _tag_spec;
  CREATE TEMP TABLE _tag_spec (form_id text, field_key text, column_key text, concept text, from_concept text) ON COMMIT DROP;
  INSERT INTO _tag_spec VALUES
    -- 오태깅 교정
    ('frm-leave-request',       'use_days',       NULL,     'quantity.days',     'quantity.hours'),
    ('frm-overtime-request',    'used_hours',     NULL,     'info.reference',    'quantity.hours'),
    ('frm-overtime-request',    'remain_hours',   NULL,     'info.reference',    'quantity.hours'),
    -- 미태깅 보정(필드)
    ('frm-absence-statement',   'absence_period', NULL,     'when.period',       NULL),
    ('frm-leave-absence',       'leave_period',   NULL,     'when.period',       NULL),
    ('frm-resignation',         'resign_date',    NULL,     'when.occurred',     NULL),
    ('frm-annual-leave-pay',    'resign_date',    NULL,     'when.occurred',     NULL),
    ('frm-annual-leave-pay',    'remaining_days', NULL,     'quantity.days',     NULL),
    ('frm-annual-leave-pay',    'daily_wage',     NULL,     'amount.unit_price', NULL),
    ('frm-annual-leave-pay',    'total_amount',   NULL,     'cost.personnel',    NULL),
    ('frm-expert-fee',          'pay_date',       NULL,     'when.occurred',     NULL),
    ('frm-expert-fee',          'gross_amount',   NULL,     'cost.outsource',    NULL),
    ('frm-certificate-request', 'copies',         NULL,     'quantity.count',    NULL),
    ('frm-work-proposal',       'budget',         NULL,     'amount.budget',     NULL),
    ('frm-purchase-request',    'need_by',        NULL,     'when.due',          NULL),
    ('frm-bonus-payment-plan',  'uniform_amount', NULL,     'amount.unit_price', NULL),
    ('frm-bonus-payment-plan',  'headcount',      NULL,     'quantity.count',    NULL),
    ('frm-bonus-payment-plan',  'total',          NULL,     'cost.personnel',    NULL),
    ('frm-bonus-plan',          'headcount',      NULL,     'quantity.count',    NULL),
    ('frm-bonus-plan',          'total',          NULL,     'cost.personnel',    NULL),
    ('frm-labor-contract',      'headcount',      NULL,     'quantity.count',    NULL),
    -- 미태깅 보정(표 열)
    ('frm-purchase-request',    'items',          'qty',        'quantity.count',    NULL),
    ('frm-purchase-request',    'items',          'unit_price', 'amount.unit_price', NULL),
    ('frm-bonus-payment-plan',  'rows',           'amount',     'cost.personnel',    NULL),
    ('frm-bonus-plan',          'rows',           'amount',     'cost.personnel',    NULL),
    ('frm-hr-appointment',      'appointments',   'appoint_date', 'when.occurred',   NULL);

  FOR f IN SELECT DISTINCT form_id FROM _tag_spec LOOP
    SELECT fields INTO cur FROM approval_forms WHERE form_id = f.form_id;
    IF cur IS NULL OR jsonb_typeof(cur) <> 'array' THEN
      RAISE NOTICE '% 없음 — 스킵', f.form_id;
      CONTINUE;
    END IF;

    SELECT jsonb_agg(
             CASE
               -- 필드 단위 태그
               WHEN EXISTS (SELECT 1 FROM _tag_spec s
                             WHERE s.form_id = f.form_id AND s.column_key IS NULL AND s.field_key = elem->>'key'
                               AND COALESCE(elem->'semantic'->>'concept', '') = COALESCE(s.from_concept, ''))
               THEN elem || jsonb_build_object('semantic',
                      COALESCE(elem->'semantic', '{}'::jsonb) || jsonb_build_object('concept',
                        (SELECT s.concept FROM _tag_spec s WHERE s.form_id = f.form_id AND s.column_key IS NULL AND s.field_key = elem->>'key' LIMIT 1)))
               -- 표 열 단위 태그
               WHEN elem->>'type' = 'table' AND jsonb_typeof(elem->'tableColumns') = 'array'
                    AND EXISTS (SELECT 1 FROM _tag_spec s WHERE s.form_id = f.form_id AND s.field_key = elem->>'key' AND s.column_key IS NOT NULL)
               THEN jsonb_set(elem, '{tableColumns}', (
                      SELECT jsonb_agg(
                               CASE WHEN COALESCE(col->'semantic'->>'concept', '') = '' AND EXISTS (
                                           SELECT 1 FROM _tag_spec s
                                            WHERE s.form_id = f.form_id AND s.field_key = elem->>'key' AND s.column_key = col->>'key')
                                    THEN col || jsonb_build_object('semantic', jsonb_build_object('concept',
                                           (SELECT s.concept FROM _tag_spec s
                                             WHERE s.form_id = f.form_id AND s.field_key = elem->>'key' AND s.column_key = col->>'key' LIMIT 1)))
                                    ELSE col END
                               ORDER BY cord)
                        FROM jsonb_array_elements(elem->'tableColumns') WITH ORDINALITY AS t(col, cord)))
               ELSE elem
             END
             ORDER BY ford)
      INTO nextfields
      FROM jsonb_array_elements(cur) WITH ORDINALITY AS e(elem, ford);

    IF nextfields IS DISTINCT FROM cur THEN
      UPDATE approval_forms SET fields = nextfields, version = version + 1, updated_at = now()::text
       WHERE form_id = f.form_id;
      INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
      SELECT form_id, version, fields, NULL, now()::text FROM approval_forms WHERE form_id = f.form_id
      ON CONFLICT (form_id, version) DO UPDATE SET fields = EXCLUDED.fields, saved_at = EXCLUDED.saved_at;
      RAISE NOTICE '%: 데이터 의미 태그 보정', f.form_id;
    ELSE
      RAISE NOTICE '%: 변경 없음', f.form_id;
    END IF;
  END LOOP;
END $$;

-- 3) 기본 지표(L3 목표 지표) — 관리자가 고쳤을 수 있어 ON CONFLICT DO NOTHING.
--    · 용역별 기성(공급가액)·외주비·기타 경비 → 기성 기준 용역 마진율(경비는 지출 행의 연관 용역으로 행 단위 귀속)
--    · 법인카드 결의 미연결(직원별) · 초과근무 신청 대비 ADT 실측 차이(직원·월별, 기안자 축)
INSERT INTO metric_definitions (metric_key, label, description, definition, visibility, version, active, created_at, updated_at) VALUES
  ('invoice_supply_by_contract', '용역별 기성(공급가액)', '계약별 세금계산서 발행 공급가액 합 — 용역 매출',
   '{"kind":"aggregate","source":{"type":"system.invoices"},"measure":{"agg":"sum","field":"supply_amount"},"groupBy":["ref.contract"]}',
   'admin', 1, 1, now()::text, now()::text),
  ('outsourcing_by_contract', '용역별 외주비', '계약별 외주 금액 합 — 용역 원가',
   '{"kind":"aggregate","source":{"type":"system.outsourcing"},"measure":{"agg":"sum","field":"amount"},"groupBy":["ref.contract"]}',
   'admin', 1, 1, now()::text, now()::text),
  ('etc_cost_by_contract', '용역별 기타 경비', '승인된 지출결의의 기타 경비(cost.etc) 합 — 지출 행의 연관 용역으로 귀속',
   '{"kind":"aggregate","source":{"type":"approval_docs","forms":"auto","status":["approved"]},"measure":{"agg":"sum","concept":"cost.etc"},"groupBy":["ref.contract"]}',
   'admin', 1, 1, now()::text, now()::text),
  ('contract_margin_by_invoice', '용역 마진율(기성 기준)', '(기성 − 외주비 − 출장 경비 − 기타 경비) ÷ 기성 — 인건비는 미포함',
   '{"kind":"composite","dimensions":["ref.contract"],"formula":["(","invoice_supply_by_contract","-","outsourcing_by_contract","-","travel_cost_by_contract","-","etc_cost_by_contract",")","/","invoice_supply_by_contract"],"format":"percent"}',
   'admin', 1, 1, now()::text, now()::text),
  ('card_unlinked_by_employee', '법인카드 결의 미연결(직원별)', '승인 건 중 지출결의에 연결되지 않은 건수 — 카드 소지 직원 기준',
   '{"kind":"aggregate","source":{"type":"system.card"},"measure":{"agg":"sum","field":"unlinked_count"},"groupBy":["ref.employee"]}',
   'admin', 1, 1, now()::text, now()::text),
  ('overtime_requested_by_drafter_month', '초과근무 신청 시간(직원·월)', '승인된 초과근무 신청의 신청시간 합 — 기안자 기준',
   '{"kind":"aggregate","source":{"type":"approval_docs","forms":["frm-overtime-request"],"status":["approved"]},"measure":{"agg":"sum","concept":"quantity.hours"},"groupBy":["doc.drafter"],"timeBy":{"concept":"when.period","bucket":"month"}}',
   'admin', 1, 1, now()::text, now()::text),
  ('overtime_actual_by_employee_month', 'ADT 인정 연장(직원·월)', 'ADT 주별 인정 연장 시간 합(주 시작일 기준 월)',
   '{"kind":"aggregate","source":{"type":"system.attendance"},"measure":{"agg":"sum","field":"overtime_hours"},"groupBy":["ref.employee"],"timeBy":{"field":"week_start","bucket":"month"}}',
   'admin', 1, 1, now()::text, now()::text),
  ('overtime_request_gap', '초과근무 신청 − 실측(직원·월)', '신청 시간 − ADT 인정 연장 — 양수면 신청이 실측보다 많다',
   '{"kind":"composite","dimensions":["ref.employee"],"formula":["overtime_requested_by_drafter_month","-","overtime_actual_by_employee_month"],"format":"number"}',
   'admin', 1, 1, now()::text, now()::text)
ON CONFLICT (metric_key) DO NOTHING;
