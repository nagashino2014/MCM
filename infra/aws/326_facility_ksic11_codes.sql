-- 326: 사업장 업종 코드(facilities.industry_code)의 KSIC 10차 코드를 11차로 통일.
--   (2026-11-01 사용자 결정 "모두 11차에 맞춰 통일" — docs/permit-industries-ksic-diff-2026-11-01.md)
-- 배경: 코드표(ksic11.json)·연간보고서 파서는 11차인데, 백엔드 통합허가 업종 목록(TARGET_INDUSTRIES)이 10차 코드를 넣어
--   스테이징 사업장 약 80곳에 11차 표에 없는 10차 코드가 남았다(2026-11-01 읽기 전용 조회: 17121 29곳·20301 28곳 등).
-- 규칙
--   - 아래 대응표의 10차 코드는 모두 11차 표에 없는 코드라 다른 뜻의 11차 코드와 겹치지 않는다(재실행해도 바뀔 것이 없다 = 멱등).
--   - 코드 단위(줄바꿈·쉼표·슬래시로 이어진 복수 코드 중 해당 코드만)로 바꾸고, 업종명(industry_name)은 건드리지 않는다.
--   - 17121 은 업종명에 '신문용지'가 있으면 17102(신문용지), 아니면 17109(기타 종이 및 판지) — 백엔드가 공식 업종명
--     '펄프, 종이 및 판지 제조업'에 일괄로 넣은 값이라 세부 업종을 알 수 없다. 통합허가 분류(종이·펄프 171*)는 어느 쪽이든 같다.
--   - 바꾸기 전 값은 facility_ksic11_conversions 에 남긴다(되돌리기용).
-- 대응표(10차 → 11차): 17121→17102/17109 · 17122→17103 · 17123→17105 · 17124→17106 · 17129→17109 ·
--   20301·20302→20202(합성수지 및 기타 플라스틱 물질) · 20431→20421 · 20432→20422 · 20433→20423 · 20332→20322 ·
--   35331→35113 · 35199→35119
-- 바꾸지 않는 것(사람 확인 필요 — 문서 §4): 형식 이상(1011·108·241), 11차 표에 없는데 뜻이 불분명한 10611·24110·26110.
-- 선행: 001(facilities). GRANT 없음(265 default privileges). 멱등.

CREATE TABLE IF NOT EXISTS facility_ksic11_conversions (
  conversion_id bigserial PRIMARY KEY,
  facility_id   text NOT NULL,
  old_code      text NOT NULL,
  new_code      text NOT NULL,
  converted_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS facility_ksic11_conversions_facility_idx ON facility_ksic11_conversions (facility_id);

DO $$
DECLARE
  m record;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      -- (10차 코드, 11차 코드, 업종명 조건: NULL = 조건 없음, news·not-news = 업종명의 '신문용지' 포함 여부)
      ('17121', '17102', 'news'),
      ('17121', '17109', 'not-news'),
      ('17122', '17103', NULL),
      ('17123', '17105', NULL),
      ('17124', '17106', NULL),
      ('17129', '17109', NULL),
      ('20301', '20202', NULL),
      ('20302', '20202', NULL),
      ('20431', '20421', NULL),
      ('20432', '20422', NULL),
      ('20433', '20423', NULL),
      ('20332', '20322', NULL),
      ('35331', '35113', NULL),
      ('35199', '35119', NULL)
    ) AS t(old_code, new_code, cond)
  LOOP
    INSERT INTO facility_ksic11_conversions (facility_id, old_code, new_code)
    SELECT f.facility_id, m.old_code, m.new_code
      FROM facilities f
     WHERE f.industry_code ~ ('\m' || m.old_code || '\M')
       AND (m.cond IS NULL
            OR (m.cond = 'news' AND COALESCE(f.industry_name, '') LIKE '%신문용지%')
            OR (m.cond = 'not-news' AND COALESCE(f.industry_name, '') NOT LIKE '%신문용지%'));

    UPDATE facilities f
       SET industry_code = regexp_replace(f.industry_code, '\m' || m.old_code || '\M', m.new_code, 'g')
     WHERE f.industry_code ~ ('\m' || m.old_code || '\M')
       AND (m.cond IS NULL
            OR (m.cond = 'news' AND COALESCE(f.industry_name, '') LIKE '%신문용지%')
            OR (m.cond = 'not-news' AND COALESCE(f.industry_name, '') NOT LIKE '%신문용지%'));
  END LOOP;
END $$;
