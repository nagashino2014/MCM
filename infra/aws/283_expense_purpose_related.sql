-- 283: 지출 목적 목록화 + 연관 용역/사업장(2026-10-16 사용자 확정).
--
-- 배경: 지출결의서에 지출 목적·관련 용역이 서로 다른 건이 섞여 올라와(초과근무 식대·인쇄비·수수료 등) 용역별 비용을
--   가릴 수 없었다. 지출 목적을 정해진 목록으로 바꾸고, 출장·초과근무 식대·인쇄/제본비는 연관 용역/사업장을 필수로 받는다.
--   · 출장보고서 지출내역 = 출장 4종(출장 식대(일용비)·출장 교통비·출장 숙박비·기타 출장 경비)만
--   · 지출결의서(법인카드·개인카드) = 일반 4종(초과근무 식대·사무용품/비품 구입·인쇄/제본비·기타 수수료)만
--   · 연관 용역/사업장 필수 = 출장 4종·초과근무 식대·인쇄/제본비 / 불필요 = 사무용품/비품 구입·기타 수수료
--   · 분류(계정과목) 열은 그대로 둔다(자동 분류·전표·경비정산 기준 유지).
-- 지출 목적은 표에 문자열 그대로 저장한다(경비정산이 detail 문자열을 스냅샷 대조 — 값 형식 불변).
-- 연관 용역/사업장은 표시 문자열을 related 열에, 계약·사업장 ID 를 행 메타 키(_relatedContractId/_relatedFacilityId)에 둔다.
--
-- 저장 위치
--   · 개인카드 영수증(personal_receipts): purpose(224) + related_contract_id·related_facility_id(이번 추가)
--     — 모바일 촬영·영수증함·웹 직접 첨부에서 고르고, 결의서 저장 때 표 행 값으로 갱신.
--   · 법인카드 사용 건: 카드 매입 원장은 회계 보호 표라 컬럼을 늘리지 않고 expense_card_tags 에 따로 둔다
--     (카드 건 ID 를 키로, 외래키 없음 — 원장 정의·가드와 분리).
--
-- 양식(approval_forms) — 관리자가 빌더로 고쳤을 수 있어 열을 key 로 찾아 바꾼다(없는 열은 건너뜀).
--   사용일시·금액 열 폭 축소, 지출 목적 → select(목록·필수·예시 도움말), 금액 다음에 연관 용역/사업장(related) 열.
--   변경 시 version+1 + 스냅샷. 기존 상신 문서는 당시 버전으로 렌더된다. 멱등.

ALTER TABLE personal_receipts ADD COLUMN IF NOT EXISTS related_contract_id text;
ALTER TABLE personal_receipts ADD COLUMN IF NOT EXISTS related_facility_id text;

CREATE TABLE IF NOT EXISTS expense_card_tags (
  card_txn_id         text PRIMARY KEY,
  purpose             text,
  related_contract_id text,
  related_facility_id text,
  updated_by          text,
  updated_at          text NOT NULL
);

DO $$
DECLARE
  spec record;
  cur jsonb;
  nextfields jsonb;
  hints jsonb := jsonb_build_object(
    '기타 출장 경비', '식대·교통비·숙박비 외 출장 중 쓴 경비 — 예: 주차료, 통행료, 현장 소모품 구입, 출장지 복사·출력비',
    '기타 수수료',    '예: 택배 발송료, 우편 반송 수수료, 시설 수선료, 증명서 발급 수수료, 송금 수수료');
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('frm-biz-trip-report',  'trip_expenses', 'spent_on',
       '["출장 식대(일용비)","출장 교통비","출장 숙박비","기타 출장 경비"]'::jsonb,
       '["출장 식대(일용비)","출장 교통비","출장 숙박비","기타 출장 경비"]'::jsonb),
      ('frm-expense-report',   'expenses',      'used_on',
       '["초과근무 식대","사무용품/비품 구입","인쇄/제본비","기타 수수료"]'::jsonb,
       '["초과근무 식대","인쇄/제본비"]'::jsonb),
      ('frm-expense-personal', 'expenses',      'used_on',
       '["초과근무 식대","사무용품/비품 구입","인쇄/제본비","기타 수수료"]'::jsonb,
       '["초과근무 식대","인쇄/제본비"]'::jsonb)
    ) AS t(form_id, table_key, date_key, purposes, need_related)
  LOOP
    SELECT fields INTO cur FROM approval_forms WHERE form_id = spec.form_id;
    IF cur IS NULL THEN
      RAISE NOTICE '% 없음 — 스킵', spec.form_id;
      CONTINUE;
    END IF;

    SELECT jsonb_agg(
             CASE WHEN elem->>'key' = spec.table_key AND elem->>'type' = 'table' THEN
               jsonb_set(elem, '{tableColumns}', (
                 SELECT jsonb_agg(c ORDER BY ord, sub)
                   FROM (
                     -- 기존 열(연관 용역/사업장 열은 아래에서 다시 만들므로 뺀다)
                     SELECT CASE
                              WHEN col->>'key' = spec.date_key THEN col || jsonb_build_object('width', 96)
                              WHEN col->>'key' = 'amount'      THEN col || jsonb_build_object('width', 96)
                              WHEN col->>'key' = 'detail' THEN
                                col || jsonb_build_object(
                                  'type', 'select',
                                  'required', true,
                                  'options', spec.purposes,
                                  'optionHints', (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
                                                    FROM jsonb_each_text(hints) AS h(k, v)
                                                   WHERE spec.purposes ? k),
                                  'hint', '목록에서 고릅니다. ' ||
                                          (SELECT string_agg(x, '·') FROM jsonb_array_elements_text(spec.need_related) x) ||
                                          ' 은(는) 연관 용역/사업장이 필수입니다.',
                                  'width', 150)
                              ELSE col
                            END AS c,
                            cord AS ord, 0 AS sub
                       FROM jsonb_array_elements(elem->'tableColumns') WITH ORDINALITY AS t2(col, cord)
                      WHERE col->>'key' <> 'related'
                     UNION ALL
                     -- 금액 열 바로 뒤에 연관 용역/사업장
                     SELECT jsonb_build_object(
                              'key', 'related',
                              'label', '연관 용역/사업장',
                              'type', 'related',
                              'requiredWhen', jsonb_build_object('key', 'detail', 'values', spec.need_related),
                              'hint', '어느 용역(없으면 사업장)에 쓴 비용인지 고릅니다. 지출 목적이 ' ||
                                      (SELECT string_agg(x, '·') FROM jsonb_array_elements_text(spec.need_related) x) ||
                                      ' 이면 필수입니다.',
                              'width', 200),
                            cord AS ord, 1 AS sub
                       FROM jsonb_array_elements(elem->'tableColumns') WITH ORDINALITY AS t3(col, cord)
                      WHERE col->>'key' = 'amount'
                   ) cols))
             ELSE elem END
             ORDER BY ford)
      INTO nextfields
      FROM jsonb_array_elements(cur) WITH ORDINALITY AS f(elem, ford);

    IF nextfields IS DISTINCT FROM cur THEN
      UPDATE approval_forms SET fields = nextfields, version = version + 1, updated_at = now()::text
       WHERE form_id = spec.form_id;
      INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
      SELECT form_id, version, fields, NULL, now()::text FROM approval_forms WHERE form_id = spec.form_id
      ON CONFLICT (form_id, version) DO UPDATE SET fields = EXCLUDED.fields, saved_at = EXCLUDED.saved_at;
      RAISE NOTICE '%: 지출 목적 목록·연관 용역/사업장 열 반영', spec.form_id;
    ELSE
      RAISE NOTICE '%: 변경 없음', spec.form_id;
    END IF;
  END LOOP;
END $$;
