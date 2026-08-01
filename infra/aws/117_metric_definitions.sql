-- 117: 지표 정의(metric_definitions) — 노코드 지표의 선언적 JSON 저장(SW-P2).
-- 설계: docs/semantic-analytics-wizard-blueprint.md §4-3.
-- definition(jsonb) = aggregate(태그 참조 집계) | composite(지표 간 산술 토큰 배열).
-- 실행은 lib/analytics/metric-engine.ts 화이트리스트 엔진(자유 SQL/eval 없음).
-- visibility(§8-2): admin(관리자만)|all|owner — 인원(ref.employee) 차원 지표는 기본 admin.
-- 관례: 멱등(시드는 ON CONFLICT DO NOTHING — 관리자가 수정한 정의를 재적용이 덮지 않는다).

CREATE TABLE IF NOT EXISTS metric_definitions (
  metric_key text PRIMARY KEY,
  label text NOT NULL,
  description text,
  definition jsonb NOT NULL,
  visibility text NOT NULL DEFAULT 'admin',   -- admin|all|owner
  created_by text,
  version integer NOT NULL DEFAULT 1,
  active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

-- 시드 6종 — 블루프린트 §6 대표 유스케이스의 실물. 마법사(SW-P3) 템플릿 갤러리의 원형이기도 하다.
INSERT INTO metric_definitions (metric_key, label, description, definition, visibility, version, active, created_at, updated_at) VALUES
  ('contract_amount_by_contract', '용역별 계약금액', '계약 마스터의 계약금액 합 — 마진율의 분모',
   '{"kind":"aggregate","source":{"type":"system.contracts"},"measure":{"agg":"sum","field":"amount"},"groupBy":["ref.contract"]}',
   'admin', 1, 1, now()::text, now()::text),
  ('travel_cost_by_contract', '용역별 출장 경비', '승인된 결재 문서에서 출장 경비(cost.travel) 태그 금액 합 — 문서의 계약 검색 필드로 귀속',
   '{"kind":"aggregate","source":{"type":"approval_docs","forms":"auto","status":["approved"]},"measure":{"agg":"sum","concept":"cost.travel"},"groupBy":["ref.contract"]}',
   'admin', 1, 1, now()::text, now()::text),
  ('contract_margin_rate', '용역 마진율(출장 경비 기준)', '(계약금액 − 출장 경비) ÷ 계약금액 — 비용 태그가 늘면 수식에 추가',
   '{"kind":"composite","dimensions":["ref.contract"],"formula":["(","contract_amount_by_contract","-","travel_cost_by_contract",")","/","contract_amount_by_contract"],"format":"percent"}',
   'admin', 1, 1, now()::text, now()::text),
  ('contracts_per_employee', '인원별 수행 용역 수', '수행인력 원장 기준 참여 계약 수(중복 제거)',
   '{"kind":"aggregate","source":{"type":"system.participants"},"measure":{"agg":"count_distinct","field":"contract_id"},"groupBy":["ref.employee"]}',
   'admin', 1, 1, now()::text, now()::text),
  ('overtime_hours_by_employee', '인원별 월 초과근무 시간', 'ADT 주별 산정의 인정 연장(시간)을 월 단위 합산',
   '{"kind":"aggregate","source":{"type":"system.attendance"},"measure":{"agg":"sum","field":"overtime_hours"},"groupBy":["ref.employee"],"timeBy":{"field":"week_start","bucket":"month"}}',
   'admin', 1, 1, now()::text, now()::text),
  ('travel_cost_by_category_month', '출장 경비 분류별 월 추이', '지출 내역 표의 분류(교통비·숙박비 등)별 월 합계 — 비용 절감 요소 탐색용',
   '{"kind":"aggregate","source":{"type":"approval_docs","forms":"auto","status":["approved"]},"measure":{"agg":"sum","concept":"cost.travel"},"groupBy":["dim.category"],"timeBy":{"concept":"when.occurred","bucket":"month"}}',
   'admin', 1, 1, now()::text, now()::text)
ON CONFLICT (metric_key) DO NOTHING;
