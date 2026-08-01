-- 119: 인원별 백분위 가중 수행 점수 지표 시드(사용자 확정 — 백분위 그대로 방식).
-- 취지: 수행 건수만으로는 성과 비교가 왜곡됨(큰 금액=일반적으로 공량 큰 용역) →
-- 참여 용역마다 계약금액 백분위(cume_dist 0~1)를 점수로 누적해, 큰 용역을 상대적으로
-- 많이 수행한 인원에게 자연스럽게 큰 가중치가 가도록 한다.
-- 참여 역할 가중은 '참여도'(본부장 고정 10~15%·실무자1 50%/2 30%/3 20% — 성과 평가 시스템에서
-- 적용 예정, groupware-workreporting 결정 참조) 도입 시 곱셈 확장 — v1 은 동일 가중.
-- 관례: 멱등(ON CONFLICT DO NOTHING).

INSERT INTO metric_definitions (metric_key, label, description, definition, visibility, version, active, created_at, updated_at) VALUES
  ('weighted_score_by_employee', '인원별 백분위 가중 수행 점수',
   '참여 용역마다 계약금액 백분위(0~1)를 누적한 점수 — 건수와 용역 규모를 함께 반영(5천만=상위 80%면 0.8점씩). 참여도 가중은 성과 평가 시스템 도입 시 확장',
   '{"kind":"aggregate","source":{"type":"system.participants"},"measure":{"agg":"sum","field":"amount_percentile"},"groupBy":["ref.employee"]}',
   'admin', 1, 1, now()::text, now()::text),
  ('amount_sum_by_employee', '인원별 참여 계약금액 총합',
   '참여한 용역들의 계약금액 합(원) — 백분위 가중 점수와 비교용(단순 금액 가중)',
   '{"kind":"aggregate","source":{"type":"system.participants"},"measure":{"agg":"sum","field":"amount_sum"},"groupBy":["ref.employee"]}',
   'admin', 1, 1, now()::text, now()::text)
ON CONFLICT (metric_key) DO NOTHING;
