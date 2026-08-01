-- 118: 수행 기간 분석 지표 시드 — 사용자 확정 아이디어(세분류별 공량 차이 → 같은 세분류 안에서
-- 비슷한 금액대끼리 묶어 평균 수행 기간 비교) 반영. 엔진의 다중 그룹(세분류×금액대)·
-- dim.amount_band(계약금액대 밴드)·dim.subcategory 차원 확장과 함께 배포.
-- 수행 기간의 원천은 계약 시작·종료일이 아니라 수행인력 원장(participated_from/to — 데이터 정확).
-- 관례: 멱등(ON CONFLICT DO NOTHING).

INSERT INTO metric_definitions (metric_key, label, description, definition, visibility, version, active, created_at, updated_at) VALUES
  ('avg_duration_by_subtype_band', '세분류·금액대별 평균 수행 기간',
   '용역 세분류 × 계약금액대 조합별 평균 수행 일수(수행인력 원장 기준) — 공량이 다른 용역을 같은 조건끼리 비교',
   '{"kind":"aggregate","source":{"type":"system.participants"},"measure":{"agg":"avg","field":"duration_days"},"groupBy":["dim.subcategory","dim.amount_band"]}',
   'admin', 1, 1, now()::text, now()::text),
  ('avg_duration_by_employee', '인원별 평균 수행 기간',
   '직원별 평균 수행 일수(수행인력 원장 기준) — 세분류·금액대 지표와 비교해 성과 맥락 해석',
   '{"kind":"aggregate","source":{"type":"system.participants"},"measure":{"agg":"avg","field":"duration_days"},"groupBy":["ref.employee"]}',
   'admin', 1, 1, now()::text, now()::text),
  ('avg_duration_by_employee_subtype', '인원·세분류별 평균 수행 기간',
   '직원 × 용역 세분류 조합별 평균 수행 일수 — 같은 세분류 안에서 인원 간 수행 기간 비교',
   '{"kind":"aggregate","source":{"type":"system.participants"},"measure":{"agg":"avg","field":"duration_days"},"groupBy":["ref.employee","dim.subcategory"]}',
   'admin', 1, 1, now()::text, now()::text)
ON CONFLICT (metric_key) DO NOTHING;
