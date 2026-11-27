-- 381_contact_person_trash.sql
-- 주소록 외부 담당자 휴지통(2026-11-27 사용자 결정, 직원 개선 요청 27).
--   주소록의 담당자 삭제를 직원(contact.edit)에게도 열되, 실제로 지우지 않고 휴지통(trash_items)으로 옮긴다.
--   휴지통 행의 before_json 에 담당자 행 전체(to_jsonb)를 담고 원본 행은 facility_contact_people 에서 뺀다 —
--   원본 표에 deleted_at 열을 두지 않아 담당자를 읽는 기존 조회 21곳을 고치지 않는다(ADT·intel 배치가 쓰는 표 스키마도 그대로).
--   복원은 before_json 으로 같은 id 의 행을 다시 넣고, 완전 삭제(trash.purge, 관리자)는 휴지통 행만 정리한다.
--   한 사람이 하루(24시간)에 옮길 수 있는 담당자는 5건 — 앱이 이 표의 deleted_by·deleted_at 으로 센다(아래 인덱스).
-- 설치 전제: 011(trash_items). 멱등.

-- item_type 허용값에 contact_person 추가. 011 의 열 CHECK 는 이름이 자동(trash_items_item_type_check)이라,
-- item_type 을 검사하는 CHECK 제약을 이름과 상관없이 모두 지우고 다시 만든다.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'trash_items'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%item_type%'
  LOOP
    EXECUTE format('ALTER TABLE trash_items DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE trash_items
  ADD CONSTRAINT trash_items_item_type_check
  CHECK (item_type IN ('facility', 'contract', 'contact_person'));

-- 하루 5건 제한 판정(직원별 최근 삭제) 조회용.
CREATE INDEX IF NOT EXISTS idx_trash_items_contact_deleter
  ON trash_items (deleted_by, deleted_at)
  WHERE item_type = 'contact_person';
