-- 143: 견적 기준 세트의 기술등급 축을 가변화.
-- 배경(2026-08-07 사용자 요청): 별첨1 MD 매트릭스의 등급이 세분류마다 다르다 —
-- 기술사가 추가되기도 하고, 특급·고급이 빠지기도 한다. 기존에는 코드 상수
-- MD_GRADES(특급·고급·중급·초급) 4종 고정이었다.
-- 등급 목록은 세트별로 저장하고, 산정 엔진(lib/quote/rates.ts)은 base_md 의 키를 직접
-- 순회하도록 바꿨으므로 이 컬럼은 UI 열 구성·문서 출력 열 순서의 기준으로 쓰인다.
-- 값은 quote_labor_rates.grade 와 같은 어휘(기술사|특급|고급|중급|초급)를 쓴다.
-- 관례: 멱등(IF NOT EXISTS), 기존 세트는 종전 4종 기본값을 유지해 동작이 바뀌지 않는다.

ALTER TABLE quote_rate_sets
  ADD COLUMN IF NOT EXISTS grades jsonb NOT NULL DEFAULT '["특급","고급","중급","초급"]'::jsonb;
