-- 375 회사소개서 마스터본 — 회사 개요·비전(c05)을 숫자로 보는 KESI(c04) 앞으로(사용자 지시 2026-11-19).
-- 코드의 기본 쪽 계획은 c05 → c04 로 바꿨지만, 마스터본은 스튜디오에서 쪽 순서를 저장해 두어(catalog_pages.order_no, 스테이징 조회 2026-11-19:
-- c04=3, c05=4) 저장한 순서가 이긴다. 두 쪽의 순서 값만 맞바꾼다. 새 01 간지(c07-01)는 저장 순서가 없어 목차 바로 뒤에 자동으로 끼워진다.
-- 문서 updated_at 도 바꿔 이 마이그레이션 전에 연 스튜디오 화면의 저장이 옛 순서로 덮지 않게 한다(저장 시 rev 충돌 안내).
-- 멱등: 둘 다 순서가 저장돼 있고 c04 가 c05 보다 앞일 때만 바꾼다.
DO $$
DECLARE
  ts text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  o4 int;
  o5 int;
BEGIN
  SELECT order_no INTO o4 FROM catalog_pages WHERE page_id = 'master:c04';
  SELECT order_no INTO o5 FROM catalog_pages WHERE page_id = 'master:c05';
  IF o4 IS NULL OR o5 IS NULL OR o4 <= 0 OR o5 <= 0 OR o4 >= o5 THEN
    RETURN;
  END IF;
  UPDATE catalog_pages SET order_no = o5, updated_at = ts WHERE page_id = 'master:c04';
  UPDATE catalog_pages SET order_no = o4, updated_at = ts WHERE page_id = 'master:c05';
  UPDATE catalog_documents SET updated_at = ts WHERE doc_id = 'master';
END
$$;
