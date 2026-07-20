-- 082: 계약 업종 옵션 개편 — 통합허가 대상 업종을 수집 설정(통합허가 대상 업종)의
-- 20개 태그명과 동일한 명칭 + '(통합허가)' 접미로 교체한다.
-- 폐기물소각/폐기물처리업은 '폐기물처리(통합허가)' 로 통일. 기존 계약의 industry_category 도 재매핑.
-- 멱등: 재실행해도 결과 동일.

BEGIN;

-- 1) 신규 통합허가 옵션 등록 (수집 설정 태그 순서)
INSERT INTO contract_industry_options (option_name, sort_order, created_at, updated_at)
VALUES
  ('발전(통합허가)', 1, now()::text, now()::text),
  ('증기열공급(통합허가)', 2, now()::text, now()::text),
  ('폐기물처리(통합허가)', 3, now()::text, now()::text),
  ('철강(통합허가)', 4, now()::text, now()::text),
  ('비철(통합허가)', 5, now()::text, now()::text),
  ('유기화학(통합허가)', 6, now()::text, now()::text),
  ('석유정제(통합허가)', 7, now()::text, now()::text),
  ('무기화학(통합허가)', 8, now()::text, now()::text),
  ('기타화학(통합허가)', 9, now()::text, now()::text),
  ('비료(통합허가)', 10, now()::text, now()::text),
  ('종이·펄프(통합허가)', 11, now()::text, now()::text),
  ('전자부품(통합허가)', 12, now()::text, now()::text),
  ('반도체(통합허가)', 13, now()::text, now()::text),
  ('섬유·염색(통합허가)', 14, now()::text, now()::text),
  ('육류가공(통합허가)', 15, now()::text, now()::text),
  ('알콜음료(통합허가)', 16, now()::text, now()::text),
  ('플라스틱(통합허가)', 17, now()::text, now()::text),
  ('자동차부품(통합허가)', 18, now()::text, now()::text),
  ('시멘트(통합허가)', 19, now()::text, now()::text),
  ('이차전지(통합허가)', 20, now()::text, now()::text)
ON CONFLICT (option_name) DO UPDATE SET sort_order = EXCLUDED.sort_order, updated_at = EXCLUDED.updated_at;

-- 2) 기존 계약의 industry_category 재매핑 (구명칭 → 신명칭)
UPDATE contracts SET industry_category = m.new_name
  FROM (VALUES
    ('발전', '발전(통합허가)'),
    ('폐기물소각', '폐기물처리(통합허가)'),
    ('폐기물처리업', '폐기물처리(통합허가)'),
    ('철강', '철강(통합허가)'),
    ('비철', '비철(통합허가)'),
    ('유기', '유기화학(통합허가)'),
    ('석유정제', '석유정제(통합허가)'),
    ('무기화학', '무기화학(통합허가)'),
    ('정밀화학', '기타화학(통합허가)'),
    ('비료및질소화합물', '비료(통합허가)'),
    ('펄프종이및판지', '종이·펄프(통합허가)'),
    ('전자부품', '전자부품(통합허가)'),
    ('반도체', '반도체(통합허가)'),
    ('섬유염색및가공처리업', '섬유·염색(통합허가)'),
    ('도축육류가공및저장처리업', '육류가공(통합허가)'),
    ('알콜음료제조업', '알콜음료(통합허가)'),
    ('플라스틱제품제조업', '플라스틱(통합허가)'),
    ('자동차부품제조업', '자동차부품(통합허가)'),
    ('시멘트 제조업', '시멘트(통합허가)'),
    ('이차전지 제조업', '이차전지(통합허가)')
  ) AS m(old_name, new_name)
 WHERE contracts.industry_category = m.old_name;

-- 3) 구명칭 옵션 제거 (계약 재매핑 완료 후라 사용처 없음)
DELETE FROM contract_industry_options
 WHERE option_name IN (
   '발전', '폐기물소각', '철강', '비철', '유기', '석유정제', '무기화학', '정밀화학',
   '비료및질소화합물', '펄프종이및판지', '전자부품', '반도체', '섬유염색및가공처리업',
   '도축육류가공및저장처리업', '알콜음료제조업', '플라스틱제품제조업', '자동차부품제조업',
   '폐기물처리업', '시멘트 제조업', '이차전지 제조업'
 );

COMMIT;
