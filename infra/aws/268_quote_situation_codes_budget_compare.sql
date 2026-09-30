-- 268: 견적 상황 변수 코드 2종 추가 (2026-09-30 사용자 요청)
-- 견적서 작성(/approval/quote) 상황 변수 목록박스에 '예산 수립용 견적 요청 대응'·'비교 견적 요청 대응'을 추가한다.
-- 정렬은 기존 코드(1~5) 뒤, '기타'(9) 앞. 관리 화면에서 이미 같은 코드를 만들었으면 그대로 둔다(멱등).

INSERT INTO quote_situation_codes (code, label, sort, enabled) VALUES
  ('budget',  '예산 수립용 견적 요청 대응', 6, 1),
  ('compare', '비교 견적 요청 대응', 7, 1)
ON CONFLICT (code) DO NOTHING;
