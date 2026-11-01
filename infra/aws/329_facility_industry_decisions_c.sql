-- 329: 사업장 업종 코드 — 사용자 결정 반영(2026-11-01 "C도 제안대로", C 그룹 9곳).
--   docs/permit-industries-ksic-diff-2026-11-01.md §5. 326·327·328 다음에 적용한다.
-- 형식 이상 코드(1011·108·241)·11차 표에 없는 코드(10611·26110)·코드와 업종명이 어긋난 사업장(10121·17901·'도금' 2곳)을
--   결정표 제안 코드로 바꾸고 업종명을 코드의 11차 이름으로 맞춘다.
-- 통합허가 업종 분류가 바뀌는 곳: '도금' 2곳(유기화학/철강 → 철강 24191). 241→24112 는 철강 그대로, 108→10831 은 대상 업종 밖 그대로.
-- 제외: C1 (유)에이엠엠케이 3공장(26221 / '플라스틱제품 제조업') — 제안이 '26221 유지 또는 22299' 두 갈래라 실제 업종 확인 후 따로 반영.
-- 안전장치: 지금 값이 326~328 적용 후 값과 같을 때만 바꾸고(업종명 없음은 빈 문자열로 비교), 전후 값은 facility_industry_fixes(327)에 남긴다. 멱등.
-- 선행: 326, 327, 328.

WITH fix(facility_id, cur_code, cur_name, new_code, new_name, reason) AS (
  VALUES
      (E'11258-00', E'20202', E'도금', E'24191', E'도금, 착색 및 기타 표면처리강재 제조업', E'C2 업종명 ''도금''(석도강판 등 표면처리강재) — 20202 → 24191 도금, 착색 및 기타 표면처리강재 제조업'),
      (E'17871-09', E'241', E'1차 철강 제조업', E'24112', E'제강업', E'C10 형식 이상 코드 → 제강업(전기로) — 241 → 24112 제강업'),
      (E'35104-00', E'24111', E'도금', E'24191', E'도금, 착색 및 기타 표면처리강재 제조업', E'C9 업종명 ''도금''(표면처리강재) — 24111 → 24191 도금, 착색 및 기타 표면처리강재 제조업'),
      (E'39637-00', E'10121', E'도축, 육류가공 및 저장처리업', E'10111', E'육류 도축업(가금류 제외)', E'C4 축산물공판장 = 소·돼지 도축 — 10121 → 10111 육류 도축업(가금류 제외)'),
      (E'53279-02', E'26110', E'전자집적회로 제조업 등', E'26111', E'메모리용 전자집적회로 제조업', E'C7 메모리 반도체 — 26110 → 26111 메모리용 전자집적회로 제조업'),
      (E'58806-05', E'17901', E'기타 종이 및 판지제품 제조업', E'17904', E'적층, 합성 및 특수표면처리 종이 제조업', E'C8 특수지 — 17901 → 17904 적층, 합성 및 특수표면처리 종이 제조업'),
      (E'69226-01', E'10611', E'도축·육류가공및저장·처리업', E'10129', E'육류 기타 가공 및 저장처리업 (가금류 제외)', E'C6 육가공 공장 — 10611 → 10129 육류 기타 가공 및 저장처리업 (가금류 제외)'),
      (E'facm_4dc7ce06315635', E'1011', E'', E'10111', E'육류 도축업(가금류 제외)', E'C3 형식 이상 코드 → 육류 도축업 — 1011 → 10111 육류 도축업(가금류 제외)'),
      (E'facm_840c0da14bf13c', E'108', E'', E'10831', E'식초, 발효 및 화학 조미료 제조업', E'C5 형식 이상 코드 → 발효 조미료 — 108 → 10831 식초, 발효 및 화학 조미료 제조업')
),
hit AS (
  SELECT f.facility_id, f.industry_code AS old_code, f.industry_name AS old_name, x.new_code, x.new_name, x.reason
    FROM fix x
    JOIN facilities f ON f.facility_id = x.facility_id
   WHERE f.industry_code = x.cur_code
     AND COALESCE(f.industry_name, '') = x.cur_name
     AND (f.industry_code IS DISTINCT FROM x.new_code OR f.industry_name IS DISTINCT FROM x.new_name)
),
logged AS (
  INSERT INTO facility_industry_fixes (facility_id, old_code, old_name, new_code, new_name, reason, source)
  SELECT facility_id, old_code, old_name, new_code, new_name, reason, '329' FROM hit
  RETURNING facility_id
)
UPDATE facilities f
   SET industry_code = h.new_code, industry_name = h.new_name
  FROM hit h
 WHERE f.facility_id = h.facility_id;
